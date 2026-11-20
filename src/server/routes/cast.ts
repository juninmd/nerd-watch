import { Hono } from 'hono';
import type { CastControlCommand, CastService } from '../cast/service.ts';
import { guardInput, readJsonObject } from '../http/json-body.ts';

const VALID_ACTIONS = new Set(['play', 'pause', 'stop', 'seek']);
/** Permite enviar legenda WebVTT (até 2 MB) junto com os metadados da sessão. */
const MAX_SESSION_BODY_BYTES = 2 * 1024 * 1024 + 16 * 1024;

const optString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * Rotas `/api/cast/*` para envio de vídeo à TV na rede local (DLNA/UPnP + link/QR LAN).
 * O relay LAN só é aberto enquanto existe uma sessão ativa.
 */
export const createCastRoutes = (service: CastService): Hono => {
  const routes = new Hono();

  routes.get('/devices', async (c) => {
    const result = await service.discover();
    return c.json(result);
  });

  routes.post('/sessions', (c) =>
    guardInput(c, async () => {
      const data = await readJsonObject(c, MAX_SESSION_BODY_BYTES);
      const src = optString(data.src);
      const title = optString(data.title) ?? 'Vídeo';
      if (!src) return c.json({ error: 'src do vídeo é obrigatório' }, 400);

      const startAt = typeof data.startAt === 'number' && Number.isFinite(data.startAt) ? data.startAt : 0;

      try {
        const session = await service.startSession({
          src,
          title,
          subtitle: optString(data.subtitle),
          poster: optString(data.poster) ?? null,
          mimeType: optString(data.mimeType),
          subtitleVtt: typeof data.subtitleVtt === 'string' ? data.subtitleVtt : null,
          startAt,
          host: optString(data.host),
          deviceId: optString(data.deviceId),
        });
        return c.json({ session }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'não foi possível iniciar a transmissão';
        return c.json({ error: message }, 400);
      }
    }),
  );

  routes.get('/sessions/:id', async (c) => {
    const state = await service.getSession(c.req.param('id'));
    if (!state) return c.json({ error: 'sessão não encontrada' }, 404);
    return c.json(state);
  });

  routes.post('/sessions/:id/control', (c) =>
    guardInput(c, async () => {
      const data = await readJsonObject(c);
      const action = optString(data.action);
      if (!action || !VALID_ACTIONS.has(action)) return c.json({ error: 'ação inválida' }, 400);

      let cmd: CastControlCommand;
      if (action === 'seek') {
        const seconds = data.seconds;
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
          return c.json({ error: 'seconds deve ser um número >= 0' }, 400);
        }
        cmd = { action: 'seek', seconds };
      } else {
        cmd = { action: action as 'play' | 'pause' | 'stop' };
      }

      try {
        const playback = await service.control(c.req.param('id'), cmd);
        return c.json({ ok: true, playback });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'falha ao controlar a TV';
        const status = message.includes('não encontrada') ? 404 : 400;
        return c.json({ error: message }, status);
      }
    }),
  );

  routes.delete('/sessions/:id', async (c) => {
    const removed = await service.stopSession(c.req.param('id'));
    if (!removed) return c.json({ error: 'sessão não encontrada' }, 404);
    return c.json({ ok: true });
  });

  return routes;
};
