import { type Context, Hono } from 'hono';
import { type createMediaService, MediaError } from '../media/service.ts';
import { serveFile } from '../providers/local/range.ts';

type Service = ReturnType<typeof createMediaService>;

/** Ids de canal e item: caracteres seguros, sem barra. Qualquer outra coisa é 404 antes de tocar no banco. */
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const ORDINAL = /^\d{1,2}$/;
const RETRY_AFTER_SECONDS = '15';

const busy = (c: Context): Response =>
  c.json({ error: 'todos os processos de conversão estão ocupados; tente de novo em instantes' }, 503, {
    'Retry-After': RETRY_AFTER_SECONDS,
  });

/**
 * Rotas de conversão para navegador (`/api/media`). Passam pela guarda de acesso do app (cookie ou Bearer).
 * `audio`, `start` e a legenda são validados no serviço e viram só números nos argumentos do ffmpeg.
 */
export const createMediaRoutes = (service: Service) => {
  const routes = new Hono();

  const handle = (fn: (c: Context, channel: string, message: string) => Promise<Response>) => async (c: Context) => {
    const channel = c.req.param('channel') ?? '';
    const message = c.req.param('message') ?? '';
    if (!ID.test(channel) || !ID.test(message)) return c.json({ error: 'identificador inválido' }, 404);
    try {
      return await fn(c, channel, message);
    } catch (err) {
      if (err instanceof MediaError) return c.json({ error: err.message }, err.status);
      return c.json({ error: 'não foi possível preparar esse vídeo agora' }, 502);
    }
  };

  routes.get(
    '/:channel/:message/plan',
    handle(async (c, ch, msg) => c.json(await service.plan(ch, msg, c.req.query('audio')))),
  );

  routes.post(
    '/:channel/:message/prepare',
    handle(async (c, ch, msg) => {
      const result = await service.prepare(ch, msg, c.req.query('audio'));
      if ('busy' in result) return busy(c);
      return c.json(result, result.state === 'ready' ? 200 : 202);
    }),
  );

  routes.get(
    '/:channel/:message/status',
    handle(async (c, ch, msg) => c.json(await service.status(ch, msg, c.req.query('audio')))),
  );

  routes.get(
    '/:channel/:message/file',
    handle(async (c, ch, msg) =>
      serveFile(await service.readyFile(ch, msg, c.req.query('audio')), c.req.header('Range')),
    ),
  );

  routes.get(
    '/:channel/:message/live',
    handle(async (c, ch, msg) => {
      const result = await service.live(ch, msg, c.req.query('audio'), c.req.query('start'));
      return 'busy' in result ? busy(c) : result;
    }),
  );

  routes.get(
    '/:channel/:message/subtitles/:ordinal',
    handle(async (c, ch, msg) => {
      const ordinal = c.req.param('ordinal') ?? '';
      if (!ORDINAL.test(ordinal)) return c.json({ error: 'legenda inválida' }, 404);
      const result = await service.subtitle(ch, msg, Number(ordinal));
      if ('busy' in result) return busy(c);
      return new Response(new TextDecoder().decode(result), {
        headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }),
  );

  return routes;
};
