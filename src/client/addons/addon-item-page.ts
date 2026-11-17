import { type AddonMetaDto, type AddonStreamDto, getAddonMeta, getAddonStreams } from '../api/stremio.ts';
import { renderInlinePlayer } from '../player/inline-player.ts';
import { parkPlayer, stopIfOnPage } from '../player/player-dock.ts';
import { renderSubtitlesPanel } from '../player/subtitles.ts';
import { backButtonHtml, wireBackButton } from '../ui/back-button.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { addonItemPath, addonPath } from './addon-links.ts';

/** Id de episódio no protocolo (`tt1:1:2`) → o IMDb `tt…` serve para buscar legenda, e o `S/E` entra junto. */
const IMDB = /^(tt\d+)(?::(\d+):(\d+))?$/;

const streamRow = (s: AddonStreamDto, i: number): string => {
  const title = escapeHtml(s.title);
  switch (s.kind) {
    case 'url':
    case 'youtube':
      return `<li><button type="button" class="btn btn-primary btn-sm stream-btn" data-play="${i}">${icon('play', 'sm')} ${title}</button></li>`;
    case 'external':
      return `<li><a class="btn btn-ghost btn-sm stream-btn" href="${escapeHtml(s.url ?? '')}" target="_blank" rel="noopener noreferrer">${icon('forward', 'sm')} ${title} (abre fora do app)</a></li>`;
    default:
      return `<li class="hint">${title}: stream por torrent/magnet não é suportado (o app só abre torrents do Internet Archive).</li>`;
  }
};

export const renderAddonItem = (host: HTMLElement, addonId: string, type: string, itemId: string): void => {
  host.innerHTML = `${backButtonHtml()}<div class="skeleton" style="height:320px;border-radius:20px"></div>`;
  wireBackButton(host, addonPath(addonId));

  const load = (currentId: string) => {
    parkPlayer();
    Promise.all([getAddonMeta(addonId, type, itemId), getAddonStreams(addonId, type, currentId).catch(() => null)])
      .then(([meta, streams]) => paint(host, addonId, type, itemId, currentId, meta, streams, load))
      .catch(() => {
        host.innerHTML = `${backButtonHtml()}<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>não foi possível carregar este item do addon</div>`;
        wireBackButton(host, addonPath(addonId));
      });
  };
  load(itemId);
};

const paint = (
  host: HTMLElement,
  addonId: string,
  type: string,
  itemId: string,
  currentId: string,
  meta: AddonMetaDto,
  streams: AddonStreamDto[] | null,
  reload: (id: string) => void,
): void => {
  const episodes = meta.videos.filter((v) => v.season !== null || v.episode !== null);
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
        <div class="side-card">
          <h3>Streams do addon</h3>
          ${
            streams === null
              ? `<p class="hint" role="alert">este addon não respondeu aos streams agora; tente de novo mais tarde.</p>`
              : streams.length === 0
                ? `<p class="hint">nenhum stream para este item.</p>`
                : `<ul class="stream-list">${streams.map(streamRow).join('')}</ul>`
          }
        </div>
        ${
          episodes.length
            ? `<div class="side-card"><h3>Episódios</h3><ul class="stream-list">${episodes
                .map((v) => `<li><button type="button" class="btn btn-ghost btn-sm stream-btn" data-ep="${escapeHtml(v.id)}"${v.id === currentId ? ' aria-current="true"' : ''}>${v.season !== null ? `T${v.season} ` : ''}${v.episode !== null ? `E${v.episode} ` : ''}${escapeHtml(v.title)}</button></li>`)
                .join('')}</ul></div>`
            : ''
        }
        <div class="side-card"><h3>Legendas</h3><div id="addon-subs"></div></div>
      </div>
    </div>`;
  wireBackButton(host, addonPath(addonId));

  const imdb = IMDB.exec(currentId);
  (host.querySelector('#addon-subs') as HTMLElement).appendChild(renderSubtitlesPanel({ query: meta.name }));

  const playerHost = host.querySelector('#addon-player') as HTMLElement;
  const note = host.querySelector('#addon-player-note') as HTMLElement;

  const play = (s: AddonStreamDto) => {
    note.textContent = '';
    if (s.kind === 'youtube' && s.url) {
      stopIfOnPage();
      playerHost.innerHTML = `<div class="player-frame"><iframe src="${escapeHtml(s.url)}" allowfullscreen title="${escapeHtml(meta.name)}"></iframe></div>`;
      return;
    }
    if (!s.url) return;
    playerHost.innerHTML = '';
    playerHost.appendChild(
      renderInlinePlayer({
        item: {
          key: `stremio:${addonId}:${currentId}`,
          src: s.url,
          title: meta.name,
          subtitle: 'Addon do Stremio',
          poster: meta.poster,
          channelId: 'stremio',
          messageId: currentId,
          durationSeconds: null,
          route: addonItemPath(addonId, type, itemId),
          captions: { query: meta.name, ...(imdb ? { season: imdb[2] ? Number(imdb[2]) : null, episode: imdb[3] ? Number(imdb[3]) : null } : {}) },
        },
        minimizable: true,
        onUnsupported: () => {
          stopIfOnPage();
          note.textContent = 'O navegador não tocou este stream; tente outro da lista.';
        },
      }),
    );
  };

  for (const b of host.querySelectorAll<HTMLButtonElement>('[data-play]')) {
    b.addEventListener('click', () => {
      const s = streams?.[Number(b.dataset.play)];
      if (s) play(s);
    });
  }
  for (const b of host.querySelectorAll<HTMLButtonElement>('[data-ep]')) {
    b.addEventListener('click', () => {
      if (b.dataset.ep) reload(b.dataset.ep);
    });
  }
};
