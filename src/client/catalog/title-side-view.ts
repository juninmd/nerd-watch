import type { TvmazeCastMember, TvmazeMoreDto } from '../api/index.ts';
import { escapeHtml, initials } from '../ui/card.ts';
import { pluralize } from '../ui/pluralize.ts';

/** HTML puro dos cartões novos da lateral da ficha (progresso, elenco compacto, temporadas). Sem DOM: testável. */

export const CAST_PREVIEW = 6;
const RING = 97.4; // circunferência de r=15.5 no viewBox 36x36

export const progressRingHtml = (watched: number, total: number, next: string | null): string => {
  if (total <= 0) return '';
  const pct = Math.round((Math.min(watched, total) / total) * 100);
  return `<div class="side-card prem-progress"><h3>Seu progresso</h3>
    <div class="prem-ring">
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="track"/><circle cx="18" cy="18" r="15.5" class="fill" stroke-dasharray="${((pct / 100) * RING).toFixed(1)} ${RING}"/></svg>
      <div><strong>${pct}%</strong><span class="dim">${watched} de ${pluralize(total, 'episódio', 'episódios')}</span></div>
    </div>
    ${next ? `<p class="prem-next"><span class="eyebrow">Próximo</span>${escapeHtml(next)}</p>` : ''}
  </div>`;
};

const castRow = (c: TvmazeCastMember, i: number): string => {
  const role = c.character?.name ?? (c.self ? 'ele(a) mesmo(a)' : '');
  const photo = c.person.imageUrl
    ? `<img src="${escapeHtml(c.person.imageUrl)}" alt="" loading="lazy" decoding="async" />`
    : `<span class="prem-avatar-empty" aria-hidden="true">${escapeHtml(initials(c.person.name))}</span>`;
  return `<li${i >= CAST_PREVIEW ? ' data-more hidden' : ''}><button type="button" data-person="${c.person.id}" aria-label="${escapeHtml(c.person.name)}${role ? `, ${escapeHtml(role)}` : ''}: biografia e outros trabalhos">${photo}<span><strong>${escapeHtml(c.person.name)}</strong>${role ? `<span class="dim">${escapeHtml(role)}${c.voice ? ' (voz)' : ''}</span>` : ''}</span></button></li>`;
};

/** Elenco compacto: seis primeiros e "ver todos". Cada pessoa abre o modal com bio e outros trabalhos. */
export const castSideHtml = (cast: TvmazeCastMember[]): string => {
  if (cast.length === 0) return '';
  const extra = cast.length - CAST_PREVIEW;
  return `<section class="side-card prem-cast" aria-labelledby="prem-cast-h"><h3 id="prem-cast-h">Elenco <span class="dim">${cast.length}</span></h3>
    <ul class="prem-cast-list" id="prem-cast-list">${cast.map(castRow).join('')}</ul>
    ${extra > 0 ? `<button type="button" class="chip" data-cast-more aria-expanded="false" aria-controls="prem-cast-list">Ver elenco completo (+${extra})</button>` : ''}
  </section>`;
};

/** Linha do tempo das temporadas: barra proporcional ao maior número de episódios; clique leva à aba. */
export const seasonsSideHtml = (m: Pick<TvmazeMoreDto, 'seasons'>, counts: Map<number, number>): string => {
  const rows = m.seasons.filter((s) => s.number > 0 && (counts.get(s.number) ?? s.episodeOrder ?? 0) > 0);
  if (rows.length < 2) return '';
  const max = Math.max(...rows.map((s) => counts.get(s.number) ?? s.episodeOrder ?? 0));
  const items = rows
    .map((s) => {
      const n = counts.get(s.number) ?? s.episodeOrder ?? 0;
      const years = [s.premiereDate?.slice(0, 4), s.endDate?.slice(2, 4)].filter(Boolean).join('–');
      return `<li><button type="button" data-season-jump="${s.number}" aria-label="Ir para a temporada ${s.number}"><span class="mono">T${s.number}</span><span class="prem-bar" aria-hidden="true"><span style="width:${Math.round((n / max) * 100)}%"></span></span><span class="dim mono">${n} ep${years ? ` · ${escapeHtml(years)}` : ''}</span></button></li>`;
    })
    .join('');
  return `<section class="side-card prem-seasons" aria-labelledby="prem-seasons-h"><h3 id="prem-seasons-h">Temporadas</h3><ol>${items}</ol></section>`;
};
