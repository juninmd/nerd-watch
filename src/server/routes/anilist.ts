import type { Database } from 'bun:sqlite';
import { Hono, type Context } from 'hono';
import { CatalogRequestError } from '../catalog-text.ts';
import { todayIso } from '../date.ts';
import { getDb } from '../db.ts';
import { anilistDetails, anilistSearch } from '../providers/anilist.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { replaceEpisodes, setCatalogStats, upsertSeason, upsertTitle } from '../repo/titles.ts';
import type { MediaType } from '../types.ts';

export const anilistRoutes = new Hono();

const ID_RE = /^\d{1,10}$/;
const SEARCH_LIMIT = 12;

const providerError = (c: Context, err: unknown) => {
  if (err instanceof CatalogRequestError) return c.json({ error: err.message }, err.status as 404 | 429 | 502);
  throw err;
};

/** Filme de anime vira `movie` (entra no calendário pela data de estreia); o resto é série. */
const mediaTypeOf = (format: string | null): MediaType => (format === 'MOVIE' ? 'movie' : 'tv');

/**
 * AniList não tem tabela de episódios: só informa o próximo. Gravamos esse episódio na temporada 1 (o AniList
 * cadastra cada temporada/cour como entrada própria) para o calendário enxergá-lo. A data é o dia local do
 * horário de exibição, o mesmo critério de `todayIso`.
 */
const persistNextEpisode = (db: Database, titleId: string, next: { airingAt: number; episode: number } | null): void => {
  if (!next) return;
  const season = upsertSeason(db, titleId, { seasonNumber: 1, name: 'Temporada 1' });
  replaceEpisodes(db, season.id, [
    { episodeNumber: next.episode, name: `Episódio ${next.episode}`, airDate: todayIso(new Date(next.airingAt * 1000)) },
  ]);
};

anilistRoutes.get('/search', async (c) => {
  const query = c.req.query('q')?.trim() ?? '';
  if (!query) return c.json({ error: 'parâmetro "q" é obrigatório' }, 400);
  if (query.length > 200) return c.json({ error: 'termo de busca muito longo' }, 400);
  try {
    return c.json({ results: await anilistSearch(query, SEARCH_LIMIT), attribution: { name: 'AniList', url: 'https://anilist.co/' } });
  } catch (err) {
    return providerError(c, err);
  }
});

anilistRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.json({ error: 'id inválido' }, 400);

  try {
    const media = await anilistDetails(Number(id));
    const db = await getDb();
    const mediaType = mediaTypeOf(media.format);
    const titleRow = upsertTitle(db, {
      source: 'anilist',
      sourceId: String(media.id),
      mediaType,
      title: media.title,
      originalTitle: media.romaji,
      overview: media.overview,
      posterPath: media.imageUrl,
      releaseDate: media.year ? `${media.year}-01-01` : null,
      voteAverage: media.averageScore === null ? null : media.averageScore / 10,
    });
    setCatalogStats(db, titleRow.id, { genres: media.genres, runtimeMinutes: media.runtimeMinutes });
    persistNextEpisode(db, titleRow.id, media.nextAiringEpisode);

    return c.json({
      titleId: titleRow.id,
      sourceId: String(media.id),
      mediaType,
      title: media.title,
      romaji: media.romaji,
      english: media.english,
      native: media.native,
      format: media.format,
      status: media.status,
      year: media.year,
      overview: media.overview,
      posterUrl: media.imageUrl,
      voteAverage: media.averageScore === null ? null : media.averageScore / 10,
      episodes: media.episodes,
      pageUrl: media.siteUrl,
      nextEpisode: media.nextAiringEpisode
        ? { episode: media.nextAiringEpisode.episode, airDate: todayIso(new Date(media.nextAiringEpisode.airingAt * 1000)) }
        : null,
      attribution: { name: 'AniList', url: 'https://anilist.co/' },
      library: getLibraryEntryByTitle(db, titleRow.id),
    });
  } catch (err) {
    return providerError(c, err);
  }
});
