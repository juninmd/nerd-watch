import { type AddonMetaDto, getAddonMeta, getTitleStreams } from '../api/stremio.ts';
import { stopIfOnPage } from '../player/player-dock.ts';
import { releaseTorrentPlayers } from '../player/torrent-player.ts';
import { renderSubtitlesPanel } from '../player/subtitles.ts';
import { trailerFrameHtml } from '../player/trailer-embed.ts';
import { backButtonHtml, wireBackButton } from '../ui/back-button.ts';
import { escapeHtml, initials, posterCssUrl } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { episodeLabel, isSeriesRoot, listEpisodes, parseImdbEpisodeId } from './addon-episode.ts';
import { addonItemPath, addonPath } from './addon-links.ts';
import { filterEpisodes, groupEpisodes } from './episode-model.ts';
import { mountStreams } from './title-streams-panel.ts';

/** Uma linha só com o que o addon mandou: ano · duração · gêneros. */
const metaLine = (meta: AddonMetaDto): string =>
  [meta.year, meta.runtime, meta.genres.join(', ')]
    .filter((x): x is string => Boolean(x))
    .map(escapeHtml)
    .join(' · ');

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
    ${backButtonHtml()}
    <header class="hero">
      <div class="backdrop placeholder" id="addon-backdrop"></div>
      <div class="scrim"></div>
      <div class="hero-content">
        <div class="hero-poster placeholder" id="addon-poster"><div style="display:grid;place-items:center;height:100%;background:var(--gradient-soft);font-size:34px;font-weight:800">${escapeHtml(initials(meta.name))}</div></div>
        <div class="hero-info">
          <h1>${escapeHtml(meta.name)}</h1>
          <div class="hero-meta">${metaLine(meta)}</div>
          <p class="hero-overview">${escapeHtml(meta.description || 'Sem sinopse disponível.')}</p>
          ${meta.trailerKey ? '<div class="hero-actions"><button class="btn btn-ghost" type="button" data-jump="trailer">Trailer</button></div>' : ''}
        </div>
      </div>
    </header>
    <div class="detail-grid">
      <div>
        ${trailerFrameHtml(meta.trailerKey)}
        <div id="addon-player"></div>
      </div>
      <div>
        <div class="side-card" id="addon-streams-card">
          <h3 id="addon-streams-title">Streams</h3>
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

  // URL de imagem por CSSOM, como nas fitas de título: o dado do addon nunca vira marcação.
  const backdrop = host.querySelector<HTMLElement>('#addon-backdrop');
  if (meta.background && backdrop) {
    backdrop.classList.remove('placeholder');
    backdrop.style.backgroundImage = posterCssUrl(meta.background);
  }
  const poster = host.querySelector<HTMLElement>('#addon-poster');
  if (meta.poster && poster) {
    poster.classList.remove('placeholder');
    poster.style.backgroundImage = posterCssUrl(meta.poster);
    poster.innerHTML = '';
  }

  host.querySelector('[data-jump="trailer"]')?.addEventListener('click', () => {
    const target = host.querySelector<HTMLElement>('#trailer');
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
  });

  const playerHost = host.querySelector('#addon-player') as HTMLElement;
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
    playerHost.innerHTML = '';
  };

  const loadStreams = async (currentId: string, scroll: boolean): Promise<void> => {
    const mine = ++seq;
    const ep = episodes.find((v) => v.id === currentId);
    const label = ep ? `${meta.name} · ${episodeLabel(ep)}` : meta.name;
    const isRootOfSeries = isSeriesRoot(meta, episodes.length, currentId, itemId);

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
    streamsTitle.textContent = ep ? `Streams — ${episodeLabel(ep)}` : 'Streams';
    streamsBox.innerHTML = '<div class="skeleton" style="height:56px"></div>';
    streamsBox.setAttribute('aria-busy', 'true');
    if (scroll) reveal(streamsCard);

    // O addon do item entra pelo id original; os outros addons de stream (Torrentio etc.) entram
    // pelo IMDb, então o item aberto no catálogo mostra torrents além dos streams do próprio addon.
    const imdb = parseImdbEpisodeId(currentId);
    const mediaType: 'movie' | 'tv' = type === 'movie' || meta.type === 'movie' ? 'movie' : 'tv';
    const dto = await getTitleStreams({
      addonId,
      type,
      itemId: currentId,
      mediaType,
      ...(imdb && !isRootOfSeries ? { imdbId: imdb.imdbId, season: imdb.season, episode: imdb.episode } : {}),
    }).catch(() => null);
    if (mine !== seq || !streamsBox.isConnected) return;

    streamsBox.removeAttribute('aria-busy');
    // Grupos que responderam "nada" (sem erro) só poluem a lista quando outro addon trouxe streams.
    const groups = dto?.addons.filter((g) => g.streams.length > 0 || g.error !== null) ?? [];
    const hasStreams = groups.some((g) => g.streams.length > 0);
    if (dto && groups.length > 0 && (!isRootOfSeries || hasStreams)) {
      mountStreams(streamsBox, { ...dto, addons: groups }, {
        title: label,
        posterUrl: meta.poster,
        route,
        playerHost,
        captions: {
          query: meta.name,
          mediaType,
          season: imdb?.season ?? null,
          episode: imdb?.episode ?? null,
        },
      });
      return;
    }

    streamsBox.onclick = null;
    if (isRootOfSeries) {
      streamsBox.innerHTML = '<p class="hint">Escolha um episódio abaixo para carregar os streams.</p>';
    } else if (dto === null) {
      streamsBox.innerHTML = '<p class="hint" role="alert">não foi possível consultar os addons agora; tente de novo mais tarde.</p>';
    } else {
      streamsBox.innerHTML = '<p class="hint">nenhum stream para este título.</p>';
    }
  };

  episodesBox?.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-ep]');
    if (btn?.dataset.ep) void loadStreams(btn.dataset.ep, true);
  });

  // Em séries com episódios listados, já carrega o primeiro episódio ou o item raiz se for filme.
  void loadStreams(itemId, false);
};
