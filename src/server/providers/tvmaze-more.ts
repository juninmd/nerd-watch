import { withCache } from '../lib/cache.ts';
import { htmlToText, httpsUrlOrNull } from '../lib/catalog-text.ts';
import { normalizeGenres, normalizeRuntimeMinutes } from '../stats/catalog-fields.ts';
import { imageOf, isRecord, tvmazeGet, unexpected } from './tvmaze.ts';

/** Tudo que a ficha completa da série mostra além do básico: elenco, equipe, galeria, akas, canais, ids externos e próximos episódios. */
const MINUTES = 60_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const date = (v: unknown): string | null => (typeof v === 'string' && DATE_RE.test(v) ? v : null);
const ratingOf = (v: unknown): number | null => (isRecord(v) ? num(v.average) : null);

export interface TvmazePerson {
  id: number;
  name: string;
  imageUrl: string | null;
  country: string | null;
  birthday: string | null;
  deathday: string | null;
  gender: string | null;
}

export const toPerson = (raw: unknown): TvmazePerson | null => {
  if (!isRecord(raw) || typeof raw.id !== 'number' || typeof raw.name !== 'string') return null;
  return {
    id: raw.id,
    name: raw.name,
    imageUrl: imageOf(raw.image),
    country: isRecord(raw.country) ? str(raw.country.name) : null,
    birthday: date(raw.birthday),
    deathday: date(raw.deathday),
    gender: str(raw.gender),
  };
};

export interface TvmazeCastMember {
  person: TvmazePerson;
  character: { name: string; imageUrl: string | null } | null;
  voice: boolean;
  self: boolean;
}
export interface TvmazeCrewMember {
  role: string;
  person: TvmazePerson;
}
export interface TvmazeImage {
  type: string;
  main: boolean;
  url: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
}
export interface TvmazeChannel {
  name: string;
  country: string | null;
  url: string | null;
  web: boolean;
}
export interface TvmazeSeasonInfo {
  number: number;
  name: string | null;
  episodeOrder: number | null;
  premiereDate: string | null;
  endDate: string | null;
  imageUrl: string | null;
  summary: string | null;
  channel: string | null;
}
export interface TvmazeEpisodeMeta {
  id: number;
  season: number;
  number: number | null;
  name: string;
  airdate: string | null;
  airstamp: string | null;
  runtime: number | null;
  rating: number | null;
  type: string | null;
  url: string | null;
  imageUrl: string | null;
}
export interface TvmazeMore {
  type: string | null;
  language: string | null;
  genres: string[];
  status: string | null;
  runtimeMinutes: number | null;
  premiered: string | null;
  ended: string | null;
  scheduleTime: string | null;
  scheduleDays: string[];
  /** Peso de popularidade da TVmaze (0–100). */
  weight: number | null;
  updatedAt: number | null;
  channels: TvmazeChannel[];
  externals: { imdb: string | null; thetvdb: number | null; tvrage: number | null };
  akas: Array<{ name: string; country: string | null }>;
  cast: TvmazeCastMember[];
  crew: TvmazeCrewMember[];
  images: TvmazeImage[];
  seasons: TvmazeSeasonInfo[];
  episodes: TvmazeEpisodeMeta[];
  nextEpisode: TvmazeEpisodeMeta | null;
  previousEpisode: TvmazeEpisodeMeta | null;
}

const list = (embedded: Record<string, unknown>, key: string): unknown[] => (Array.isArray(embedded[key]) ? (embedded[key] as unknown[]) : []);

const channelOf = (raw: unknown, web: boolean): TvmazeChannel | null => {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null;
  return { name: raw.name, country: isRecord(raw.country) ? str(raw.country.name) : null, url: httpsUrlOrNull(raw.officialSite), web };
};

const toEpisodeMeta = (raw: unknown): TvmazeEpisodeMeta | null => {
  if (!isRecord(raw) || typeof raw.id !== 'number' || typeof raw.season !== 'number') return null;
  return {
    id: raw.id,
    season: raw.season,
    number: Number.isInteger(raw.number) ? (raw.number as number) : null,
    name: str(raw.name) ?? 'Sem título',
    airdate: date(raw.airdate),
    airstamp: str(raw.airstamp),
    runtime: num(raw.runtime),
    rating: ratingOf(raw.rating),
    type: str(raw.type),
    url: httpsUrlOrNull(raw.url),
    imageUrl: imageOf(raw.image),
  };
};

const toCast = (raw: unknown): TvmazeCastMember[] => {
  if (!isRecord(raw)) return [];
  const person = toPerson(raw.person);
  if (!person) return [];
  const ch = isRecord(raw.character) && typeof raw.character.name === 'string' ? { name: raw.character.name, imageUrl: imageOf(raw.character.image) } : null;
  return [{ person, character: ch, voice: raw.voice === true, self: raw.self === true }];
};

const toImage = (raw: unknown): TvmazeImage[] => {
  if (!isRecord(raw) || !isRecord(raw.resolutions) || !isRecord(raw.resolutions.original)) return [];
  const original = raw.resolutions.original;
  const url = httpsUrlOrNull(original.url);
  if (!url) return [];
  const medium = isRecord(raw.resolutions.medium) ? httpsUrlOrNull(raw.resolutions.medium.url) : null;
  return [{ type: str(raw.type) ?? 'other', main: raw.main === true, url, thumbUrl: medium ?? url, width: num(original.width), height: num(original.height) }];
};

const toSeason = (raw: unknown): TvmazeSeasonInfo[] => {
  if (!isRecord(raw) || typeof raw.number !== 'number') return [];
  const ch = channelOf(raw.webChannel, true) ?? channelOf(raw.network, false);
  return [
    {
      number: raw.number,
      name: str(raw.name),
      episodeOrder: num(raw.episodeOrder),
      premiereDate: date(raw.premiereDate),
      endDate: date(raw.endDate),
      imageUrl: imageOf(raw.image),
      summary: htmlToText(typeof raw.summary === 'string' ? raw.summary : null),
      channel: ch?.name ?? null,
    },
  ];
};

const EMBEDS = ['cast', 'crew', 'akas', 'images', 'seasons', 'episodes', 'nextepisode', 'previousepisode'];

/** Uma única chamada com todos os embeds (limite de 20/10 s por IP): a ficha completa custa 1 requisição por hora de cache. */
export const tvmazeShowMore = withCache(60 * MINUTES, async (id: number): Promise<TvmazeMore> => {
  const raw = await tvmazeGet(`/shows/${id}`, { embed: EMBEDS });
  if (!isRecord(raw)) throw unexpected();
  const emb = isRecord(raw._embedded) ? raw._embedded : {};
  const ext = isRecord(raw.externals) ? raw.externals : {};
  const sched = isRecord(raw.schedule) ? raw.schedule : {};
  const channels = [channelOf(raw.webChannel, true), channelOf(raw.network, false)].filter((c): c is TvmazeChannel => c !== null);
  const imdb = str(ext.imdb);
  const toMetaOrNull = (v: unknown) => (Array.isArray(v) ? null : toEpisodeMeta(v));
  return {
    type: str(raw.type),
    language: str(raw.language),
    genres: normalizeGenres(raw.genres) ?? [],
    status: str(raw.status),
    runtimeMinutes: normalizeRuntimeMinutes(raw.averageRuntime ?? raw.runtime),
    premiered: date(raw.premiered),
    ended: date(raw.ended),
    scheduleTime: str(sched.time),
    scheduleDays: Array.isArray(sched.days) ? sched.days.filter((d): d is string => typeof d === 'string') : [],
    weight: num(raw.weight),
    updatedAt: num(raw.updated),
    channels,
    externals: { imdb: imdb && /^tt\d{5,10}$/.test(imdb) ? imdb : null, thetvdb: num(ext.thetvdb), tvrage: num(ext.tvrage) },
    akas: list(emb, 'akas').flatMap((a) => (isRecord(a) && typeof a.name === 'string' ? [{ name: a.name, country: isRecord(a.country) ? str(a.country.name) : null }] : [])),
    cast: list(emb, 'cast').flatMap(toCast),
    crew: list(emb, 'crew').flatMap((c) => {
      const person = isRecord(c) ? toPerson(c.person) : null;
      return person && isRecord(c) ? [{ role: str(c.type) ?? 'Equipe', person }] : [];
    }),
    images: list(emb, 'images').flatMap(toImage),
    seasons: list(emb, 'seasons').flatMap(toSeason),
    episodes: list(emb, 'episodes').flatMap((e) => toEpisodeMeta(e) ?? []),
    nextEpisode: toMetaOrNull(emb.nextepisode),
    previousEpisode: toMetaOrNull(emb.previousepisode),
  };
});
