import type { TvmazeCrewMember, TvmazeEpisodeMeta, TvmazeMoreDto, TvmazePerson } from '../api/index.ts';
import { pluralize } from '../ui/pluralize.ts';

/** Regras puras (sem DOM) das seções extras da ficha TVmaze: testáveis direto. O desenho fica em `tvmaze-sections.tsx`. */

export const dateLabel = (iso: string | null): string => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'a confirmar');

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

export const episodeCodeOf = (e: Pick<TvmazeEpisodeMeta, 'season' | 'number'>): string => `T${e.season}${e.number === null ? ' especial' : `·E${e.number}`}`;

export const stampLabel = (e: TvmazeEpisodeMeta): string => {
  if (e.airstamp) {
    const d = new Date(e.airstamp);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return dateLabel(e.airdate);
};

/** A agenda some só em série encerrada sem próximo nem último episódio. */
export const showAgenda = (m: Pick<TvmazeMoreDto, 'nextEpisode' | 'previousEpisode' | 'status'>): boolean =>
  Boolean(m.nextEpisode || m.previousEpisode) || m.status !== 'Ended';

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

/** Onde assistir segundo a TVmaze: streaming (webChannel) ou emissora (network). */
export const channelKind = (c: { web: boolean }): string => (c.web ? 'streaming' : 'TV');

/** Links externos só para os ids que a TVmaze trouxe. */
export const externalLinks = (m: Pick<TvmazeMoreDto, 'externals'>): Array<[string, string]> => {
  const links: Array<[string, string]> = [];
  if (m.externals.imdb) links.push(['IMDb', `https://www.imdb.com/title/${m.externals.imdb}/`]);
  if (m.externals.thetvdb !== null) links.push(['TheTVDB', `https://thetvdb.com/?tab=series&id=${m.externals.thetvdb}`]);
  if (m.externals.tvrage !== null) links.push(['TVRage', `https://www.tvmaze.com/shows/${m.externals.tvrage}`]);
  return links;
};

/** Notas e tipo por episódio, indexados por `temporada:número` para o cruzamento com a lista já pintada. */
export const metaByEpisode = (episodes: TvmazeEpisodeMeta[]): Map<string, TvmazeEpisodeMeta> => {
  const map = new Map<string, TvmazeEpisodeMeta>();
  for (const e of episodes) if (e.number !== null) map.set(`${e.season}:${e.number}`, e);
  return map;
};

/** Linha da temporada (estreia, final, encomenda, emissora) mostrada sob as abas de episódios. */
export const seasonSummaryText = (m: Pick<TvmazeMoreDto, 'seasons'>, seasonNumber: number): string => {
  const s = m.seasons.find((x) => x.number === seasonNumber);
  if (!s) return '';
  return [
    s.premiereDate ? `estreia ${dateLabel(s.premiereDate)}` : null,
    s.endDate ? `final ${dateLabel(s.endDate)}` : null,
    s.episodeOrder ? pluralize(s.episodeOrder, 'episódio encomendado', 'episódios encomendados') : null,
    s.channel,
  ]
    .filter((b): b is string => Boolean(b))
    .join(' · ');
};

/** Selo de tipo do episódio (especial/extra); episódio comum não tem selo. */
export const episodeTypeTag = (e: Pick<TvmazeEpisodeMeta, 'type'> | undefined): string | null => {
  if (!e?.type || e.type === 'regular') return null;
  return e.type === 'significant_special' ? 'especial' : e.type === 'insignificant_special' ? 'extra' : e.type;
};
