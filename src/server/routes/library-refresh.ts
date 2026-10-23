import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { createCooldown, type Cooldown } from '../metadata/cooldown.ts';
import { describeError } from '../metadata/refresh-job.ts';
import { refreshTitleFromTmdb } from '../metadata/refresh-service.ts';
import type { RefreshResult } from '../metadata/refresher.ts';
import { TmdbNotConfiguredError, TmdbRequestError } from '../providers/tmdb.ts';
import { getTitle } from '../repo/titles.ts';
import type { TitleRow } from '../types.ts';

/** Um clique a cada 60 s por título: evita martelar a TMDB com o botão. */
export const REFRESH_COOLDOWN_MS = 60_000;

export interface LibraryRefreshDeps {
  getDb: () => Promise<Database>;
  refresh: (db: Database, title: TitleRow) => Promise<RefreshResult>;
  cooldown: Cooldown;
}

/** Rota com dependências injetadas: o app usa os padrões abaixo; os testes trocam o provider e o relógio. */
export const createLibraryRefreshRoutes = (deps: LibraryRefreshDeps): Hono => {
  const app = new Hono();

  app.post('/:titleId/refresh', async (c) => {
    const db = await deps.getDb();
    const title = getTitle(db, c.req.param('titleId'));
    if (!title) return c.json({ error: 'título não encontrado' }, 404);
    if (title.source !== 'tmdb') return c.json({ error: 'só títulos da TMDB têm metadados para atualizar' }, 400);

    const slot = deps.cooldown.tryAcquire(title.id);
    if (!slot.ok) {
      c.header('Retry-After', String(slot.retryAfterSec));
      return c.json({ error: `aguarde ${slot.retryAfterSec} s para atualizar de novo`, retryAfterSeconds: slot.retryAfterSec }, 429);
    }

    try {
      const result = await deps.refresh(db, title);
      return c.json({ titleId: title.id, seasons: result.seasons, episodes: result.episodes, refreshedAt: result.refreshedAt });
    } catch (err) {
      if (err instanceof TmdbNotConfiguredError) return c.json({ error: err.message }, 501);
      if (err instanceof TmdbRequestError) return c.json({ error: err.message }, err.status === 404 ? 404 : 502);
      console.warn(`[nerd-watch] atualização manual de metadados falhou (${describeError(err)})`);
      return c.json({ error: 'falha ao atualizar metadados' }, 500);
    }
  });

  return app;
};

export const libraryRefreshRoutes = createLibraryRefreshRoutes({
  getDb,
  refresh: (db, title) => refreshTitleFromTmdb(db, title),
  cooldown: createCooldown(REFRESH_COOLDOWN_MS),
});
