import { getTitleStreams, type TitleStreamsDto, type TitleStreamsQuery } from '../api/stremio.ts';
import { escapeHtml } from '../ui/card.ts';

type Group = TitleStreamsDto['addons'][number];

const streamLi = (s: Group['streams'][number]): string =>
  s.url
    ? `<li><a class="btn btn-ghost btn-sm stream-btn" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a></li>`
    : `<li class="hint">${escapeHtml(s.title)}: torrent/magnet, que o app não abre (só torrents do Internet Archive).</li>`;

const groupHtml = (g: Group): string => {
  const body = g.error
    ? `<p class="hint" role="alert">erro: ${escapeHtml(g.error)}</p>`
    : g.streams.length
      ? `<ul class="stream-list">${g.streams.map(streamLi).join('')}</ul>`
      : '<p class="hint">nenhum stream para este título.</p>';
  return `<h4>${escapeHtml(g.name)} <small>${escapeHtml(g.host)}</small></h4>${body}`;
};

export const streamsHtml = (d: TitleStreamsDto): string => d.addons.map(groupHtml).join('');

/** Addons só de streams não têm catálogo: os streams entram aqui, a partir do IMDb do título do TMDB. Sem addon de stream, o card some. */
export const renderTitleStreams = (host: HTMLElement, opts: TitleStreamsQuery): void => {
  const card = host.closest<HTMLElement>('.side-card');
  if (card) card.hidden = true;
  getTitleStreams(opts)
    .then((d) => {
      if (!d.addons.length) return;
      if (card) card.hidden = false;
      host.innerHTML = streamsHtml(d);
    })
    .catch(() => {
      // Falha geral (ex.: TMDB fora): sem addons instalados não há o que avisar, então o card segue oculto.
    });
};
