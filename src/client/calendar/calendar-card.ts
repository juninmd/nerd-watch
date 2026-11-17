import type { CalendarEntryDto, CalendarInfoDto, CalendarOrigin } from '../api/index.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';

export type AgendaEntry = Omit<CalendarEntryDto, 'titleId'>;

export const ORIGIN_LABEL: Record<CalendarOrigin, string> = { serie: 'Série', filme: 'Filme', anime: 'Anime' };

/** Origem conhecida sem rede: a fonte do catálogo e o tipo já dizem se é anime, filme ou série. */
export const originOf = (e: AgendaEntry, info?: CalendarInfoDto | null): CalendarOrigin =>
  info?.origin ?? (e.titleSource === 'anilist' ? 'anime' : e.mediaType === 'movie' ? 'filme' : 'serie');

/** "Streaming · Netflix, Max", "Cinema", "TV · HBO"; vazio enquanto a ficha não chegou. */
export const whereLabel = (info?: CalendarInfoDto | null): string => {
  if (!info) return '';
  const names = info.providers.slice(0, 3).map((p) => p.name).join(', ');
  if (info.where === 'cinema') return 'Nos cinemas';
  if (info.where === 'stream') return names ? `Streaming · ${names}` : 'Streaming';
  if (info.where === 'tv') return names ? `TV · ${names}` : 'TV';
  return names;
};

export const entryKey = (e: AgendaEntry): string => `${e.titleSource}:${e.mediaType}:${e.titleSourceId}`;

export const episodeLine = (e: AgendaEntry): string =>
  e.kind === 'episode'
    ? `T${e.seasonNumber} · Ep ${e.episodeNumber}${e.episodeName ? ` — ${e.episodeName}` : ''}`
    : 'Estreia do filme';

export const ratingText = (rating: number | null | undefined): string => (rating ? rating.toFixed(1) : '');

const ratingBadge = (rating: number | null): string => (rating ? `<span class="cal-rating" title="Nota">★ ${ratingText(rating)}</span>` : '');

const extLink = (url: string, label: string, cls = 'cal-link'): string =>
  `<a class="${cls}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;

/** Cartão rico da Agenda. `info` nulo = ficha ainda não carregada (o cartão mostra o que já sabe). */
export const cardHtml = (e: AgendaEntry, info: CalendarInfoDto | null): string => {
  const origin = originOf(e, info);
  const where = whereLabel(info);
  const poster = e.posterUrl
    ? `<img src="${escapeHtml(e.posterUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : icon('film');
  const trailer = info?.trailerKey
    ? `<button class="cal-link" type="button" data-act="detail">${icon('play')} Trailer</button>`
    : info
      ? extLink(info.trailerSearchUrl, 'Buscar trailer')
      : '';
  const page = info?.pageUrl ? extLink(info.pageUrl, 'Página') : '';
  const synopsis = info?.synopsis ? `<p class="cal-syn">${escapeHtml(info.synopsis)}</p>` : '';
  return `
  <article class="cal-card" data-origin="${origin}" data-where="${info?.where ?? 'desconhecido'}" data-key="${escapeHtml(entryKey(e))}" data-source="${e.titleSource}" data-source-id="${escapeHtml(e.titleSourceId)}" data-media="${e.mediaType}" data-date="${e.date}"${info ? '' : ' data-needs-info="1"'} tabindex="0" role="button" aria-label="${escapeHtml(e.titleName)}: ver detalhes">
    <div class="cal-poster">${poster}</div>
    <div class="cal-body">
      <div class="cal-badges">
        <span class="cal-pill origin-${origin}">${ORIGIN_LABEL[origin]}</span>
        ${where ? `<span class="cal-pill where-${info?.where}">${escapeHtml(where)}</span>` : ''}
        ${ratingBadge(info?.rating ?? null)}
      </div>
      <h3 class="cal-title">${escapeHtml(e.titleName)}</h3>
      <div class="cal-ep">${escapeHtml(episodeLine(e))}</div>
      ${info?.genres.length ? `<div class="cal-genres">${escapeHtml(info.genres.slice(0, 3).join(' · '))}</div>` : ''}
      ${synopsis}
      <div class="cal-actions">${trailer}${page}</div>
    </div>
  </article>`;
};

/** Faixa de destaque: o primeiro item da lista com capa larga. */
export const spotlightHtml = (e: AgendaEntry, info: CalendarInfoDto): string => `
  <section class="cal-spot" data-key="${escapeHtml(entryKey(e))}" aria-label="Em destaque" style="--spot:url('${escapeHtml(info.backdropUrl ?? '')}')">
    <div class="cal-spot-body">
      <span class="cal-pill origin-${info.origin}">${ORIGIN_LABEL[info.origin]}</span>
      <h2>${escapeHtml(e.titleName)}</h2>
      <div class="cal-ep">${escapeHtml(episodeLine(e))} · ${escapeHtml(new Date(`${e.date}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }))}${whereLabel(info) ? ` · ${escapeHtml(whereLabel(info))}` : ''}</div>
      ${info.synopsis ? `<p class="cal-syn">${escapeHtml(info.synopsis)}</p>` : ''}
      <button class="btn btn-primary btn-sm" type="button" data-act="detail">Ver detalhes</button>
    </div>
  </section>`;

export { extLink };
