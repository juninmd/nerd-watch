import { Hono } from 'hono';
import { hasControlChar } from '../lib/text-guards.ts';
import { ValidationError } from '../lib/validation-error.ts';
import { commonsSearchVideos, commonsVideoDetails } from '../providers/commons.ts';

const MAX_QUERY_LEN = 200;

export const commonsRoutes = new Hono();

commonsRoutes.get('/search', async (c) => {
  const query = c.req.query('q')?.trim() ?? '';
  if (query.length > MAX_QUERY_LEN || hasControlChar(query)) return c.json({ error: 'consulta inválida' }, 400);
  try {
    return c.json({ results: await commonsSearchVideos(query, 24) });
  } catch {
    return c.json({ error: 'Wikimedia Commons indisponível no momento' }, 502);
  }
});

commonsRoutes.get('/file', async (c) => {
  try {
    const video = await commonsVideoDetails(c.req.query('title') ?? '');
    return video ? c.json(video) : c.json({ error: 'vídeo não encontrado' }, 404);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    return c.json({ error: 'Wikimedia Commons indisponível no momento' }, 502);
  }
});
