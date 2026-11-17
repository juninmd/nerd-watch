import type { CalendarInfoDto } from '../api/index.ts';
import { trailerFrameHtml } from '../player/trailer-embed.ts';
import { escapeHtml } from '../ui/card.ts';
import { type AgendaEntry, episodeLine, extLink, ORIGIN_LABEL, ratingText, whereLabel } from './calendar-card.ts';
import { icon } from '../ui/icons.ts';

let dialog: HTMLDialogElement | null = null;

const providersHtml = (info: CalendarInfoDto): string =>
  info.providers.length
    ? `<div class="cal-prov"><h3>Onde assistir</h3><div class="cal-prov-list">${info.providers
        .map((p) => (p.url ? extLink(p.url, p.name, 'cal-chip') : `<span class="cal-chip">${escapeHtml(p.name)}</span>`))
        .join('')}</div></div>`
    : info.where === 'cinema'
      ? `<div class="cal-prov"><h3>Onde assistir</h3><p class="cal-dim">Em exibição nos cinemas.</p></div>`
      : `<div class="cal-prov"><h3>Onde assistir</h3><p class="cal-dim">Ainda sem serviço confirmado para a sua região.</p></div>`;

/** Detalhe do item: capa larga, sinopse, onde assistir, links e trailer (o iframe só carrega ao clicar). */
export const openCalendarDetail = (e: AgendaEntry, info: CalendarInfoDto | null, onOpenTitle: () => void): void => {
  if (dialog?.open) dialog.close();
  const d = document.createElement('dialog');
  d.className = 'cal-dialog';
  d.setAttribute('aria-labelledby', 'cal-dlg-title');
  const i = info;
  d.innerHTML = `
    <div class="cal-dlg-hero"${i?.backdropUrl ? ` style="--spot:url('${escapeHtml(i.backdropUrl)}')"` : ''}>
      <button class="btn btn-ghost btn-sm cal-dlg-close" type="button" aria-label="Fechar">${icon('x')}</button>
      <div class="cal-dlg-head">
        ${i ? `<span class="cal-pill origin-${i.origin}">${ORIGIN_LABEL[i.origin]}</span>` : ''}
        <h2 id="cal-dlg-title" tabindex="-1">${escapeHtml(e.titleName)}</h2>
        <div class="cal-ep">${escapeHtml(episodeLine(e))} · ${escapeHtml(new Date(`${e.date}T00:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }))}</div>
      </div>
    </div>
    <div class="cal-dlg-body">
      ${
        i
          ? `<div class="cal-badges">${whereLabel(i) ? `<span class="cal-pill where-${i.where}">${escapeHtml(whereLabel(i))}</span>` : ''}${i.rating ? `<span class="cal-rating">★ ${ratingText(i.rating)}</span>` : ''}${i.genres
              .slice(0, 4)
              .map((g) => `<span class="cal-chip">${escapeHtml(g)}</span>`)
              .join('')}</div>
            <p class="cal-syn full">${i.synopsis ? escapeHtml(i.synopsis) : 'Sem sinopse disponível.'}</p>
            ${providersHtml(i)}
            <div id="cal-trailer">${i.trailerKey ? `<button class="btn btn-primary" type="button" id="cal-play">${icon('play')} Assistir trailer</button>` : extLink(i.trailerSearchUrl, 'Buscar trailer no YouTube', 'btn')}</div>
            <div class="cal-dlg-links">${i.pageUrl ? extLink(i.pageUrl, 'Página do título') : ''}${i.officialUrl ? extLink(i.officialUrl, 'Site oficial') : ''}</div>`
          : `<div class="empty-state">não foi possível carregar os detalhes agora</div>`
      }
      <div class="cal-dlg-foot"><button class="btn" type="button" id="cal-open">Abrir no nerd-watch</button></div>
    </div>`;
  document.body.appendChild(d);
  dialog = d;
  d.addEventListener('close', () => {
    d.remove();
    if (dialog === d) dialog = null;
  });
  d.addEventListener('click', (ev) => {
    if (ev.target === d) d.close();
  });
  d.querySelector('.cal-dlg-close')?.addEventListener('click', () => d.close());
  d.querySelector('#cal-open')?.addEventListener('click', () => {
    d.close();
    onOpenTitle();
  });
  d.querySelector('#cal-play')?.addEventListener('click', () => {
    const slot = d.querySelector('#cal-trailer');
    if (slot) slot.innerHTML = trailerFrameHtml(i?.trailerKey);
    slot?.querySelector<HTMLElement>('#trailer')?.focus();
  });
  d.showModal();
  d.querySelector<HTMLElement>('#cal-dlg-title')?.focus();
};
