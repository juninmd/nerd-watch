import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { archiveMovieDetails, archiveSearchPublicDomain } from '../providers/archive.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { upsertTitle } from '../repo/titles.ts';

export const archiveRoutes = new Hono();

archiveRoutes.get('/search', async (c) => {
  const query = c.req.query('q')?.trim() ?? '';
  try {
    const results = await archiveSearchPublicDomain(query, 24);
    return c.json({ results });
  } catch {
    return c.json({ error: 'Internet Archive indisponível no momento' }, 502);
  }
});

archiveRoutes.get('/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  try {
    const movie = await archiveMovieDetails(identifier);
    if (!movie) return c.json({ error: 'item não encontrado' }, 404);

    const db = await getDb();
    const titleRow = upsertTitle(db, {
      source: 'archive',
      sourceId: movie.identifier,
      mediaType: 'movie',
      title: movie.title,
      overview: movie.overview,
      posterPath: movie.thumbnailUrl,
      releaseDate: movie.year ? `${movie.year}-01-01` : null,
    });
    const libraryEntry = getLibraryEntryByTitle(db, titleRow.id);

    return c.json({
      titleId: titleRow.id,
      identifier: movie.identifier,
      title: movie.title,
      overview: movie.overview,
      year: movie.year,
      posterUrl: movie.thumbnailUrl,
      embedUrl: movie.embedUrl,
      torrentUrl: movie.torrentUrl,
      detailsUrl: movie.detailsUrl,
      library: libraryEntry,
    });
  } catch {
    return c.json({ error: 'Internet Archive indisponível no momento' }, 502);
  }
});
