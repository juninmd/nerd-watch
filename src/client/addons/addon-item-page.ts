import {
  type AddonMetaDto,
  type AddonStreamDto,
  getAddonMeta,
  getAddonStreams,
  getTitleStreams,
  openAddonStream,
} from '../api/stremio.ts';
import { renderInlinePlayer } from '../player/inline-player.ts';
import { stopIfOnPage } from '../player/player-dock.ts';
import { releaseTorrentPlayers, renderTorrentPanel } from '../player/torrent-player.ts';
import { renderSubtitlesPanel } from '../player/subtitles.ts';
import { backButtonHtml, wireBackButton } from '../ui/back-button.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { episodeLabel, listEpisodes, parseImdbEpisodeId } from './addon-episode.ts';
import { addonCaptionTracks } from './addon-captions.ts';
import { addonItemPath, addonPath } from './addon-links.ts';
import { groupEpisodes, filterEpisodes } from './episode-model.ts';
import { streamCardHtml } from './stream-card.ts';
import { mountStreams } from './title-streams-panel.ts';

const streamRow = (s: AddonStreamDto, i: number): string =>
  streamCardHtml(s, {
    buttonAttrs: s.kind === 'torrent' ? `data-torrent="${i}"` : `data-play="${i}"`,
  });

export const renderAddonItem = (host: HTMLElement, addonId: string, type: string, itemId: string): void => {
  const root = document.createElement('div');
  host.replaceChildren(root);
  root.innerHTML = `${backButtonHtml()}<div class="skeleton" style="height:320px;border-radius:20px"></div>`;
  wireBackButton(root, addonPath(addonId));

  getAddonMeta(addonId, type, itemId)
    .then((meta) => {
      if (!root.isConnected) return;
      mountItem(root, addonId, type, itemId, meta);
    })
    .catch(() => {
      if (!root.isConnected) return;
      root.innerHTML = `${backButtonHtml()}<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>não foi possível carregar este item do addon</div>`;
      wireBackButton(root, addonPath(addonId));
    });
};

const mountItem = (host: HTMLElement, addonId: string, type: string, itemId: string, meta: AddonMetaDto): void => {
  const episodes = listEpisodes(meta);
  const route = addonItemPath(addonId, type, itemId);

  host.innerHTML = `
    <header class="view-head">
      ${backButtonHtml()}
      <h1 class="view-title">${escapeHtml(meta.name)}</h1>
      <p class="view-subtitle">${[meta.year, meta.runtime, meta.genres.join(', ')].filter((x): x is string => Boolean(x)).map(escapeHtml).join(' · ')}</p>
    </header>
    <div class="detail-grid">
      <div>
        <div id="addon-player"></div>
        <p class="hint" id="addon-player-note"></p>
        <p>${escapeHtml(meta.description || 'Sem sinopse disponível.')}</p>
      </div>
      <div>
        <div class="side-card" id="addon-streams-card">
          <h3 id="addon-streams-title">Streams do addon</h3>
          <div id="addon-streams"><div class="skeleton" style="height:56px"></div></div>
        </div>
        ${
          episodes.length
            ? `<div class="side-card" id="addon-episodes-card">
                <h3>Episódios</h3>
                <div class="chip-row form-row">
                  <select id="addon-season" class="select input-pill" aria-label="temporada" hidden></select>
                  <input type="search" id="addon-ep-filter" class="input input-pill grow" placeholder="filtrar episódio" autocomplete="off" aria-label="filtrar episódio" />
                </div>
                <ul class="stream-list" id="addon-episodes"></ul>
                <p class="hint" id="addon-ep-empty" hidden>nenhum episódio com esse filtro.</p>
              </div>`
            : ''
        }
        <div class="side-card"><h3>Legendas</h3><div id="addon-subs"></div></div>
      </div>
    </div>`;
  wireBackButton(host, addonPath(addonId));

  const playerHost = host.querySelector('#addon-player') as HTMLElement;
  const note = host.querySelector('#addon-player-note') as HTMLElement;
  const streamsCard = host.querySelector('#addon-streams-card') as HTMLElement;
  const streamsTitle = host.querySelector('#addon-streams-title') as HTMLElement;
  const streamsBox = host.querySelector('#addon-streams') as HTMLElement;
  const episodesBox = host.querySelector('#addon-episodes') as HTMLElement | null;
  const seasonSelect = host.querySelector('#addon-season') as HTMLSelectElement | null;
  const episodeFilter = host.querySelector('#addon-ep-filter') as HTMLInputElement | null;
  const episodesEmpty = host.querySelector('#addon-ep-empty') as HTMLElement | null;

  (host.querySelector('#addon-subs') as HTMLElement).appendChild(renderSubtitlesPanel({ query: meta.name }));

  let seq = 0;
  /** Episódio aberto agora: o filtro e a troca de temporada redesenham a lista em volta dele. */
  let current = itemId;
  const seasons = groupEpisodes(episodes);
  let season: number | null = seasons[0]?.season ?? null;

  /** Marca o episódio aberto; a lista é redesenhada a cada troca de temporada/filtro. */
  const markCurrent = () => {
    if (!episodesBox) return;
    for (const b of episodesBox.querySelectorAll<HTMLButtonElement>('[data-ep]')) {
      if (b.dataset.ep === current) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  };

  const paintEpisodes = () => {
    if (!episodesBox) return;
    const group = seasons.find((s) => s.season === season) ?? seasons[0];
    const visible = filterEpisodes(group?.episodes ?? [], episodeFilter?.value ?? '');
    episodesBox.innerHTML = visible
      .map(
        (v) =>
          `<li><button type="button" class="btn btn-ghost btn-sm stream-btn" data-ep="${escapeHtml(v.id)}">${escapeHtml(episodeLabel(v))}</button></li>`,
      )
      .join('');
    // Temporada sem resultado do filtro: mensagem em vez de lista vazia sem explicação.
    if (episodesEmpty) episodesEmpty.hidden = visible.length > 0;
    markCurrent();
  };

  if (seasonSelect) {
    // Uma temporada só não precisa de seletor; "Extras" (season null) vira o valor vazio do <select>.
    seasonSelect.hidden = seasons.length <= 1;
    seasonSelect.innerHTML = seasons
      .map((s) => `<option value="${s.season ?? ''}">${escapeHtml(`${s.label} (${s.episodes.length})`)}</option>`)
      .join('');
    seasonSelect.value = season === null ? '' : String(season);
    seasonSelect.addEventListener('change', () => {
      season = seasonSelect.value === '' ? null : Number(seasonSelect.value);
      paintEpisodes();
    });
  }
  episodeFilter?.addEventListener('input', paintEpisodes);
  paintEpisodes();

  const reveal = (el: HTMLElement) => {
    el.scrollIntoView({ block: 'nearest' });
  };

  const resetPlayer = () => {
    stopIfOnPage();
    releaseTorrentPlayers();
    note.textContent = '';
    playerHost.innerHTML = '';
  };

  const playStream = (currentId: string, label: string, s: AddonStreamDto, streamIndex: number) => {
    resetPlayer();
    const imdb = parseImdbEpisodeId(currentId);
    if (s.kind === 'youtube' && s.url) {
      playerHost.innerHTML = `<div class="player-frame"><iframe src="${escapeHtml(s.url)}" allowfullscreen title="${escapeHtml(label)}"></iframe></div>`;
      reveal(playerHost);
      return;
    }
    if (!s.url) return;
    const addonTracks = addonCaptionTracks({ addonId, type, contentId: currentId, streamIndex, subtitles: s.subtitles });
    playerHost.appendChild(
      renderInlinePlayer({
        item: {
          key: `stremio:${addonId}:${currentId}`,
          src: s.url,
          title: label,
          subtitle: 'Addon do Stremio',
          poster: meta.poster,
          channelId: 'stremio',
          messageId: currentId,
          durationSeconds: null,
          route,
          captions: {
            query: meta.name,
            ...(imdb ? { season: imdb.season, episode: imdb.episode } : {}),
            ...(addonTracks.length > 0 ? { addonTracks } : {}),
          },
        },
        minimizable: true,
        onUnsupported: () => {
          stopIfOnPage();
          note.textContent = 'O navegador não tocou este stream; tente outro da lista.';
        },
      }),
    );
    reveal(playerHost);
  };

  const playTorrent = (currentId: string, label: string, index: number) => {
    resetPlayer();
    let panel: HTMLElement | null = null;
    panel = renderTorrentPanel({
      identifier: currentId,
      title: label,
      posterUrl: meta.poster,
      open: (fileIndex) => openAddonStream(addonId, type, currentId, index, fileIndex),
      sourceLabel: 'Addon · P2P',
      hint: 'O servidor conecta direto nos peers deste torrent e serve os pedaços ao player; nada fica semeando ao sair da tela.',
      player: { channelId: 'addon', messageId: currentId, route },
      autoStart: true,
      onRelease: () => panel?.remove(),
    });
    playerHost.appendChild(panel);
    reveal(playerHost);
  };

  const loadStreams = async (currentId: string, scroll: boolean): Promise<void> => {
    const mine = ++seq;
    const ep = episodes.find((v) => v.id === currentId);
    const label = ep ? `${meta.name} · ${episodeLabel(ep)}` : meta.name;

    current = currentId;
    if (ep && (ep.season ?? null) !== season) {
      // Episódio de outra temporada (link direto, "continuar assistindo"): troca o seletor antes de marcar.
      season = ep.season ?? null;
      if (seasonSelect && !seasonSelect.hidden) seasonSelect.value = season === null ? '' : String(season);
      paintEpisodes();
    } else {
      markCurrent();
    }

    if (scroll) resetPlayer();
    streamsTitle.textContent = ep ? `Streams — ${episodeLabel(ep)}` : 'Streams do addon';
    streamsBox.innerHTML = '<div class="skeleton" style="height:56px"></div>';
    streamsBox.setAttribute('aria-busy', 'true');
    if (scroll) reveal(streamsCard);

    const ownStreams = await getAddonStreams(addonId, type, currentId).catch(() => null);
    if (mine !== seq || !streamsBox.isConnected) return;

    if (ownStreams && ownStreams.length > 0) {
      streamsBox.removeAttribute('aria-busy');
      streamsBox.innerHTML = `<ul class="stream-list">${ownStreams.map(streamRow).join('')}</ul>`;
      streamsBox.onclick = (event) => {
        const playBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-play]');
        if (playBtn) {
          const index = Number(playBtn.dataset.play);
          const s = ownStreams[index];
          if (s) playStream(currentId, label, s, index);
          return;
        }
        const torBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-torrent]');
        if (torBtn) {
          const idx = Number(torBtn.dataset.torrent);
          if (ownStreams[idx]) playTorrent(currentId, label, idx);
        }
      };
      return;
    }

    // Addon só de catálogo/meta (ex.: Cinemeta) não devolve stream próprio: consulta os outros addons de stream instalados.
    const imdb = parseImdbEpisodeId(currentId);
    if (imdb && (type === 'movie' || imdb.episode !== null || episodes.length === 0)) {
      const mediaType = type === 'movie' ? 'movie' : 'tv';
      const fallback = await getTitleStreams({
        imdbId: imdb.imdbId,
        mediaType,
        season: imdb.season,
        episode: imdb.episode,
      }).catch(() => null);
      if (mine !== seq || !streamsBox.isConnected) return;
      streamsBox.removeAttribute('aria-busy');
      if (fallback && fallback.addons.length > 0) {
        mountStreams(streamsBox, fallback, {
          title: label,
          posterUrl: meta.poster,
          route,
          playerHost,
          captions: { query: meta.name, mediaType, season: imdb.season, episode: imdb.episode },
        });
        return;
      }
    }

    streamsBox.removeAttribute('aria-busy');
    streamsBox.onclick = null;
    if (episodes.length > 0 && currentId === itemId) {
      streamsBox.innerHTML = '<p class="hint">Escolha um episódio abaixo para carregar os streams.</p>';
    } else if (ownStreams === null) {
      streamsBox.innerHTML = '<p class="hint" role="alert">este addon não respondeu aos streams agora; tente de novo mais tarde.</p>';
    } else {
      streamsBox.innerHTML = '<p class="hint">nenhum stream para este episódio.</p>';
    }
  };

  episodesBox?.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-ep]');
    if (btn?.dataset.ep) void loadStreams(btn.dataset.ep, true);
  });

  // Em séries com episódios listados, já carrega o primeiro episódio ou o item raiz se for filme.
  void loadStreams(itemId, false);
};
