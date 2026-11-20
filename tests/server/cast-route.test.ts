import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { DlnaClient, DlnaStatus } from '../../src/server/cast/dlna-client.ts';
import type { CastDevice } from '../../src/server/cast/dlna-xml.ts';
import { createCastRelay } from '../../src/server/cast/relay.ts';
import { createCastService } from '../../src/server/cast/service.ts';
import { createCastRoutes } from '../../src/server/routes/cast.ts';

const FAKE_TV: CastDevice = {
  id: 'uuid:tv-sala',
  name: 'TV da Sala',
  manufacturer: 'LG',
  model: 'webOS',
  host: '192.168.1.40',
  location: 'http://192.168.1.40:1555/desc.xml',
  controlUrl: 'http://192.168.1.40:1555/avtransport',
};

const setup = () => {
  const calls: string[] = [];
  const state: DlnaStatus = { state: 'PLAYING', positionSeconds: 120, durationSeconds: 3600 };
  const dlna: DlnaClient = {
    loadAndPlay: async (_dev, meta) => {
      calls.push(`load:${meta.title}`);
    },
    play: async () => {
      calls.push('play');
      state.state = 'PLAYING';
    },
    pause: async () => {
      calls.push('pause');
      state.state = 'PAUSED_PLAYBACK';
    },
    stop: async () => {
      calls.push('stop');
      state.state = 'STOPPED';
    },
    seek: async (_dev, sec) => {
      calls.push(`seek:${sec}`);
      state.positionSeconds = sec;
    },
    status: async () => ({ ...state }),
  };

  const relay = createCastRelay({
    hostname: '127.0.0.1',
    port: 0,
    internalFetch: () => new Response('ok', { headers: { 'Content-Type': 'video/mp4' } }),
  });

  const service = createCastService({
    relay,
    dlna,
    discover: async () => [FAKE_TV],
    listInterfaces: () => [{ name: 'Wi-Fi', address: '192.168.1.10', score: 55 }],
    toQrDataUrl: async (url) => `data:image/png;base64,QR(${url})`,
  });

  const app = new Hono();
  app.route('/api/cast', createCastRoutes(service));
  return { app, calls, relay };
};

describe('rotas /api/cast', () => {
  test('descobre TVs, cria sessão na TV, controla play/pause/seek e encerra fechando o relay', async () => {
    const { app, calls, relay } = setup();

    const devRes = await app.request('/api/cast/devices');
    expect(devRes.status).toBe(200);
    const devBody = (await devRes.json()) as { defaultHost: string; devices: Array<{ id: string; name: string }> };
    expect(devBody.defaultHost).toBe('192.168.1.10');
    expect(devBody.devices[0]?.name).toBe('TV da Sala');

    const startRes = await app.request('/api/cast/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        src: '/api/telegram/ch1/items/10/stream',
        title: 'Episódio 1',
        deviceId: 'uuid:tv-sala',
        startAt: 30,
      }),
    });
    expect(startRes.status).toBe(201);
    const { session } = (await startRes.json()) as {
      session: { id: string; watchUrl: string; mediaUrl: string; qrDataUrl: string; device: { name: string } };
    };
    expect(session.watchUrl).toStartWith('http://192.168.1.10:');
    expect(session.mediaUrl).toContain('/media');
    expect(session.qrDataUrl).toStartWith('data:image/png;base64,QR(');
    expect(session.device.name).toBe('TV da Sala');
    expect(calls).toContain('load:Episódio 1');

    // Pause
    const pauseRes = await app.request(`/api/cast/sessions/${session.id}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(pauseRes.status).toBe(200);
    const pauseBody = (await pauseRes.json()) as { playback: DlnaStatus };
    expect(pauseBody.playback.state).toBe('PAUSED_PLAYBACK');

    // Seek
    const seekRes = await app.request(`/api/cast/sessions/${session.id}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seek', seconds: 300 }),
    });
    expect(seekRes.status).toBe(200);
    expect(calls).toContain('seek:300');

    // Status
    const getRes = await app.request(`/api/cast/sessions/${session.id}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { playback: DlnaStatus };
    expect(getBody.playback.positionSeconds).toBe(300);

    // Encerrar
    const delRes = await app.request(`/api/cast/sessions/${session.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
    expect(calls).toContain('stop');
    expect(relay.port()).toBeNull();
  });

  test('valida entradas inválidas (src ausente, ação desconhecida, sessão inexistente)', async () => {
    const { app, relay } = setup();
    try {
      const noSrc = await app.request('/api/cast/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Sem src' }),
      });
      expect(noSrc.status).toBe(400);

      const badSrc = await app.request('/api/cast/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: 'file:///etc/passwd', title: 'Malicioso' }),
      });
      expect(badSrc.status).toBe(400);

      const notFound = await app.request('/api/cast/sessions/inexistente');
      expect(notFound.status).toBe(404);

      const badAct = await app.request('/api/cast/sessions/inexistente/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'explode' }),
      });
      expect(badAct.status).toBe(400);
    } finally {
      relay.stop();
    }
  });
});
