import type { TvmazeCastMember, TvmazeCrewMember, TvmazeEpisodeMeta, TvmazeImage, TvmazeMoreDto, TvmazePerson } from '../api/index.ts';
import { escapeHtml, initials } from '../ui/card.ts';
import { pluralize } from '../ui/pluralize.ts';

/** HTML puro (sem DOM) das seções extras da ficha TVmaze: testável direto. Todo dado externo passa por `escapeHtml`. */

const PERSON_HREF = (id: number): string => `#/person/tvmaze/${id}`;
const MAX_CAST = 24;
const MAX_IMAGES = 18;

export const dateLabel = (iso: string | null): string => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'a confirmar');

const portrait = (url: string | null, name: string): string =>
  url ? `<img class="tvm-photo" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" />` : `<span class="tvm-photo tvm-photo-empty" aria-hidden="true">${escapeHtml(initials(name))}</span>`;

export const personCardHtml = (p: TvmazePerson, line1: string | null, line2: string | null): string => `
  <a class="tvm-person" href="${PERSON_HREF(p.id)}" aria-label="${escapeHtml(p.name)}">
    ${portrait(p.imageUrl, p.name)}
    <span class="tvm-person-name">${escapeHtml(p.name)}</span>
    ${line1 ? `<span class="tvm-person-sub">${escapeHtml(line1)}</span>` : ''}
    ${line2 ? `<span class="tvm-person-sub dim">${escapeHtml(line2)}</span>` : ''}
  </a>`;

export const castHtml = (cast: TvmazeCastMember[]): string => {
  if (cast.length === 0) return '';
  const shown = cast.slice(0, MAX_CAST);
  const more = cast.length - shown.length;
  const cards = shown.map((c) => personCardHtml(c.person, c.character?.name ?? null, c.voice ? 'voz' : c.self ? 'ele(a) mesmo(a)' : c.person.country)).join('');
  return `<div class="section-head"><h2>Elenco</h2></div><div class="tvm-people">${cards}</div>${more > 0 ? `<p class="hint">e mais ${pluralize(more, 'pessoa', 'pessoas')} no elenco (veja na TVmaze)</p>` : ''}`;
};

/** Equipe agrupada por função (Criador, Produtor Executivo…), na ordem em que a TVmaze lista. */
export const groupCrew = (crew: TvmazeCrewMember[]): Array<{ role: string; people: TvmazePerson[] }> => {
  const byRole = new Map<string, Map<number, TvmazePerson>>();
  for (const c of crew) {
    const people = byRole.get(c.role) ?? new Map<number, TvmazePerson>();
    people.set(c.person.id, c.person);
    byRole.set(c.role, people);
  }
  return [...byRole.entries()].map(([role, people]) => ({ role, people: [...people.values()] }));
};

export const crewHtml = (crew: TvmazeCrewMember[]): string => {
  const groups = groupCrew(crew);
  if (groups.length === 0) return '';
  const rows = groups
    .map(
      (g) =>
        `<div class="tvm-crew-row"><h3>${escapeHtml(g.role)}</h3><div class="tvm-chips">${g.people.map((p) => `<a class="tvm-chip" href="${PERSON_HREF(p.id)}">${escapeHtml(p.name)}</a>`).join('')}</div></div>`,
    )
    .join('');
  return `<div class="section-head"><h2>Equipe</h2></div><div class="tvm-crew">${rows}</div>`;
};

const IMAGE_TYPE_LABEL: Record<string, string> = { poster: 'pôsteres', banner: 'banners', background: 'fundos', typography: 'logotipos', other: 'outras' };

/** Galeria por tipo: miniatura abre a imagem original em outra aba. */
export const galleryHtml = (images: TvmazeImage[]): string => {
  if (images.length === 0) return '';
  const shown = images.slice(0, MAX_IMAGES);
  const tiles = shown
    .map(
      (i) =>
        `<a class="tvm-shot ${escapeHtml(i.type)}" href="${escapeHtml(i.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(IMAGE_TYPE_LABEL[i.type] ?? i.type)}: abrir imagem original"><img src="${escapeHtml(i.thumbUrl)}" alt="" loading="lazy" decoding="async" /></a>`,
    )
    .join('');
  return `<div class="section-head"><h2>Galeria</h2></div><div class="tvm-gallery">${tiles}</div>`;
};

export const episodeCodeOf = (e: Pick<TvmazeEpisodeMeta, 'season' | 'number'>): string => `T${e.season}${e.number === null ? ' especial' : `·E${e.number}`}`;

const stampLabel = (e: TvmazeEpisodeMeta): string => {
  if (e.airstamp) {
    const d = new Date(e.airstamp);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return dateLabel(e.airdate);
};

const episodeLine = (label: string, e: TvmazeEpisodeMeta | null): string =>
  e ? `<div class="tvm-next"><span class="tvm-next-label">${label}</span><strong>${escapeHtml(episodeCodeOf(e))} · ${escapeHtml(e.name)}</strong><span class="dim">${escapeHtml(stampLabel(e))}${e.rating ? ` · ★ ${e.rating.toFixed(1)}` : ''}</span></div>` : '';

export const nextPrevHtml = (more: TvmazeMoreDto): string => {
  const body = episodeLine('Próximo episódio', more.nextEpisode) + episodeLine('Último episódio', more.previousEpisode);
  if (body) return `<div class="side-card"><h3>Agenda</h3>${body}</div>`;
  return more.status === 'Ended' ? '' : `<div class="side-card"><h3>Agenda</h3><p class="hint">sem próximo episódio anunciado</p></div>`;
};

const DAYS: Record<string, string> = { Monday: 'seg', Tuesday: 'ter', Wednesday: 'qua', Thursday: 'qui', Friday: 'sex', Saturday: 'sáb', Sunday: 'dom' };

/** Pares rótulo/valor da ficha técnica; só entra o que a TVmaze preencheu. */
export const factsOf = (m: TvmazeMoreDto): Array<[string, string]> => {
  const out: Array<[string, string | null]> = [
    ['Tipo', m.type],
    ['Idioma', m.language],
    ['Status', m.status],
    ['Estreia', m.premiered ? dateLabel(m.premiered) : null],
    ['Final', m.ended ? dateLabel(m.ended) : null],
    ['Duração', m.runtimeMinutes ? `${m.runtimeMinutes} min` : null],
    ['Horário', m.scheduleDays.length || m.scheduleTime ? [m.scheduleDays.map((d) => DAYS[d] ?? d).join(', '), m.scheduleTime].filter(Boolean).join(' · ') : null],
    ['Gêneros', m.genres.length ? m.genres.join(', ') : null],
    ['Popularidade', m.weight === null ? null : `${m.weight}/100`],
  ];
  return out.filter((r): r is [string, string] => r[1] !== null && r[1] !== '');
};

export const factsHtml = (m: TvmazeMoreDto): string => {
  const rows = factsOf(m)
    .map(([k, v]) => `<div class="tvm-fact"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');
  return rows ? `<div class="side-card"><h3>Ficha técnica</h3><dl class="tvm-facts">${rows}</dl></div>` : '';
};

/** Onde assistir segundo a TVmaze: streaming (webChannel) e/ou emissora (network). */
export const channelsHtml = (m: TvmazeMoreDto): string => {
  if (m.channels.length === 0) return '';
  const items = m.channels
    .map((c) => {
      const label = `${escapeHtml(c.name)}${c.country ? ` <span class="dim">(${escapeHtml(c.country)})</span>` : ''}`;
      const kind = c.web ? 'streaming' : 'TV';
      return c.url
        ? `<a class="tvm-chip" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${label} · ${kind}</a>`
        : `<span class="tvm-chip">${label} · ${kind}</span>`;
    })
    .join('');
  return `<div class="side-card"><h3>Onde assistir</h3><div class="tvm-chips">${items}</div></div>`;
};

export const externalLinksHtml = (m: TvmazeMoreDto): string => {
  const links: Array<[string, string]> = [];
  if (m.externals.imdb) links.push(['IMDb', `https://www.imdb.com/title/${m.externals.imdb}/`]);
  if (m.externals.thetvdb !== null) links.push(['TheTVDB', `https://thetvdb.com/?tab=series&id=${m.externals.thetvdb}`]);
  if (m.externals.tvrage !== null) links.push(['TVRage', `https://www.tvmaze.com/shows/${m.externals.tvrage}`]);
  return links.length ? `<div class="tvm-chips">${links.map(([n, u]) => `<a class="tvm-chip" href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${n}</a>`).join('')}</div>` : '';
};

export const akasHtml = (m: TvmazeMoreDto): string => {
  if (m.akas.length === 0) return '';
  const items = m.akas.map((a) => `<li>${escapeHtml(a.name)}${a.country ? ` <span class="dim">· ${escapeHtml(a.country)}</span>` : ''}</li>`).join('');
  return `<div class="side-card"><h3>Títulos alternativos</h3><ul class="tvm-akas">${items}</ul></div>`;
};

/** Notas e tipo por episódio, indexados por `temporada:número` para o cruzamento com a lista já pintada. */
export const metaByEpisode = (episodes: TvmazeEpisodeMeta[]): Map<string, TvmazeEpisodeMeta> => {
  const map = new Map<string, TvmazeEpisodeMeta>();
  for (const e of episodes) if (e.number !== null) map.set(`${e.season}:${e.number}`, e);
  return map;
};

export const seasonSummaryHtml = (m: TvmazeMoreDto, seasonNumber: number): string => {
  const s = m.seasons.find((x) => x.number === seasonNumber);
  if (!s) return '';
  const bits = [
    s.premiereDate ? `estreia ${dateLabel(s.premiereDate)}` : null,
    s.endDate ? `final ${dateLabel(s.endDate)}` : null,
    s.episodeOrder ? pluralize(s.episodeOrder, 'episódio encomendado', 'episódios encomendados') : null,
    s.channel,
  ].filter((b): b is string => Boolean(b));
  return bits.length ? `<p class="hint tvm-season-meta">${escapeHtml(bits.join(' · '))}</p>` : '';
};

export const episodeBadgesHtml = (e: TvmazeEpisodeMeta | undefined): string => {
  if (!e) return '';
  const bits = [e.rating ? `<span class="tvm-rate">★ ${e.rating.toFixed(1)}</span>` : '', e.runtime ? `<span class="dim">${e.runtime} min</span>` : '', e.type && e.type !== 'regular' ? `<span class="tvm-chip">${escapeHtml(e.type === 'significant_special' ? 'especial' : e.type === 'insignificant_special' ? 'extra' : e.type)}</span>` : ''];
  return bits.filter(Boolean).join(' ');
};
