import { withCache } from '../lib/cache.ts';
import { httpsUrlOrNull } from '../lib/catalog-text.ts';
import { imageOf, isRecord, tvmazeGet, unexpected } from './tvmaze.ts';
import { toPerson, type TvmazePerson } from './tvmaze-more.ts';

const MINUTES = 60_000;
const SHOW_HREF_RE = /\/shows\/(\d{1,10})$/;

export interface TvmazePersonCredit {
  showId: number;
  showName: string;
  /** Personagem (elenco) ou função (equipe). */
  role: string | null;
  voice: boolean;
}
export interface TvmazePersonDetails extends TvmazePerson {
  pageUrl: string | null;
  cast: TvmazePersonCredit[];
  crew: TvmazePersonCredit[];
}

/** O crédito traz só o link do show (`_links.show.{href,name}`): extraímos id e nome dele, sem uma chamada por show. */
const creditOf = (raw: unknown, roleKey: 'character' | 'type'): TvmazePersonCredit[] => {
  if (!isRecord(raw) || !isRecord(raw._links) || !isRecord(raw._links.show)) return [];
  const { href, name } = raw._links.show;
  const id = typeof href === 'string' ? SHOW_HREF_RE.exec(href)?.[1] : undefined;
  if (!id || typeof name !== 'string') return [];
  const links = raw._links;
  const role = roleKey === 'character' ? (isRecord(links.character) && typeof links.character.name === 'string' ? links.character.name : null) : typeof raw.type === 'string' ? raw.type : null;
  return [{ showId: Number(id), showName: name, role, voice: raw.voice === true }];
};

export const tvmazePersonDetails = withCache(6 * 60 * MINUTES, async (id: number): Promise<TvmazePersonDetails> => {
  const raw = await tvmazeGet(`/people/${id}`, { embed: ['castcredits', 'crewcredits'] });
  const person = toPerson(raw);
  if (!isRecord(raw) || !person) throw unexpected();
  const emb = isRecord(raw._embedded) ? raw._embedded : {};
  const credits = (key: string, roleKey: 'character' | 'type') => (Array.isArray(emb[key]) ? (emb[key] as unknown[]) : []).flatMap((c) => creditOf(c, roleKey));
  return { ...person, pageUrl: httpsUrlOrNull(raw.url), cast: credits('castcredits', 'character'), crew: credits('crewcredits', 'type') };
});

export interface TvmazePersonShow {
  showId: number;
  name: string;
  year: string | null;
  posterUrl: string | null;
  rating: number | null;
  /** Peso de popularidade (0–100): ordena do mais conhecido para o menos. */
  weight: number;
  role: string | null;
  voice: boolean;
}

const MAX_PERSON_SHOWS = 12;

/** Créditos de elenco com pôster, ano e nota numa chamada só (`embed[]=show&embed[]=character`), sem uma chamada por série. */
export const tvmazePersonShows = withCache(6 * 60 * MINUTES, async (id: number): Promise<TvmazePersonShow[]> => {
  const raw = await tvmazeGet(`/people/${id}/castcredits`, { embed: ['show', 'character'] });
  if (!Array.isArray(raw)) throw unexpected();
  const byShow = new Map<number, TvmazePersonShow>();
  for (const c of raw) {
    const emb = isRecord(c) && isRecord(c._embedded) ? c._embedded : null;
    const show = emb && isRecord(emb.show) ? emb.show : null;
    if (!show || typeof show.id !== 'number' || typeof show.name !== 'string' || byShow.has(show.id)) continue;
    byShow.set(show.id, {
      showId: show.id,
      name: show.name,
      year: typeof show.premiered === 'string' ? show.premiered.slice(0, 4) : null,
      posterUrl: imageOf(show.image),
      rating: isRecord(show.rating) && typeof show.rating.average === 'number' ? show.rating.average : null,
      weight: typeof show.weight === 'number' ? show.weight : 0,
      role: emb && isRecord(emb.character) && typeof emb.character.name === 'string' ? emb.character.name : null,
      voice: isRecord(c) && c.voice === true,
    });
  }
  return [...byShow.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_PERSON_SHOWS);
});

/** `/search/people?q=` devolve `[{ score, person }]`. */
export const tvmazeSearchPeople = withCache(15 * MINUTES, async (query: string): Promise<TvmazePerson[]> => {
  const data = await tvmazeGet('/search/people', { q: query });
  if (!Array.isArray(data)) throw unexpected();
  return data.flatMap((hit) => {
    const p = isRecord(hit) ? toPerson(hit.person) : null;
    return p ? [p] : [];
  });
});

