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
import { addonItemPath, addonPath } from './addon-links.ts';
import { streamCardHtml } from './stream-card.ts';
import { mountStreams } from './title-streams-panel.ts';

const streamRow = (s: AddonStreamDto, i: number): string =>
  streamCardHtml(s, {
    buttonAttrs: s.kind === 'torrent' ? `data-torrent="${i}"` : `data-play="${i}"`,
  });

export const renderAddonItem = (host: HTMLElement, addonId: string, type: string, itemId: string): void => {
  host.innerHTML = `${backButtonHtml()}<div class="skeleton" style="height:320px;border-radius:20px"></div>`;
  wireBackButton(host, addonPath(addonId));

  getAddonMeta(addonId, type, itemId)
    .then((meta) => mountItem(host, addonId, type, itemId, meta))
    .catch(() => {
      host.innerHTML = `${backButtonHtml()}<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>não foi possível carregar este item do addon</div>`;
      wireBackButton(host, addonPath(addonId));
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
            ? `<div class="side-card"><h3>Episódios</h3><ul class="stream-list" id="addon-episodes">${episodes
                .map(
                  (v) =>
                    `<li><button type="button" class="btn btn-ghost btn-sm stream-btn" data-ep="${escapeHtml(v.id)}">${escapeHtml(episodeLabel(v))}</button></li>`,
                )
                .join('')}</ul></div>`
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

  (host.querySelector('#addon-subs') as HTMLElement).appendChild(renderSubtitlesPanel({ query: meta.name }));

  let seq = 0;

  const reveal = (el: HTMLElement) => {
    el.scrollIntoView({ block: 'nearest' });
  };

  const resetPlayer = () => {
    stopIfOnPage();
    releaseTorrentPlayers();
    note.textContent = '';
    playerHost.innerHTML = '';
  };

  const playStream = (currentId: string, label: string, s: AddonStreamDto) => {
    resetPlayer();
    const imdb = parseImdbEpisodeId(currentId);
    if (s.kind === 'youtube' && s.url) {
      playerHost.innerHTML = `<div class="player-frame"><iframe src="${escapeHtml(s.url)}" allowfullscreen title="${escapeHtml(label)}"></iframe></div>`;
      reveal(playerHost);
      return;
    }
    if (!s.url) return;
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

    if (episodesBox) {
      for (const b of episodesBox.querySelectorAll<HTMLButtonElement>('[data-ep]')) {
        if (b.dataset.ep === currentId) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      }
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
          const s = ownStreams[Number(playBtn.dataset.play)];
          if (s) playStream(currentId, label, s);
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
