import { withCache } from '../lib/cache.ts';
import { httpsUrlOrNull } from '../lib/catalog-text.ts';
import { isRecord, tvmazeGet, unexpected } from './tvmaze.ts';
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

/** `/search/people?q=` devolve `[{ score, person }]`. */
export const tvmazeSearchPeople = withCache(15 * MINUTES, async (query: string): Promise<TvmazePerson[]> => {
  const data = await tvmazeGet('/search/people', { q: query });
  if (!Array.isArray(data)) throw unexpected();
  return data.flatMap((hit) => {
    const p = isRecord(hit) ? toPerson(hit.person) : null;
    return p ? [p] : [];
  });
});

