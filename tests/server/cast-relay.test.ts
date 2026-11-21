import { describe, expect, test } from 'bun:test';
import { createCastRelay, isSafeMediaSrc } from '../../src/server/cast/relay.ts';

describe('cast relay: isSafeMediaSrc', () => {
  test('aceita rotas internas de mídia /api/ e URLs HTTP(S) (inclusive LAN)', () => {
    expect(isSafeMediaSrc('/api/telegram/ch1/items/42/stream')).toBe(true);
    expect(isSafeMediaSrc('/api/telegram/channels/ch1/items/42/play')).toBe(true);
    expect(isSafeMediaSrc('/api/telegram/channels/ch1/items/42/thumb')).toBe(true);
    expect(isSafeMediaSrc('/api/telegram/channels/ch1/photo')).toBe(true);
    expect(isSafeMediaSrc('/api/torrent/abc123/stream?fileIndex=0')).toBe(true);
    expect(isSafeMediaSrc('/api/torrent/abc123/stream/0')).toBe(true);
    expect(isSafeMediaSrc('/api/media/ch1/item1/live?start=10')).toBe(true);
    expect(isSafeMediaSrc('/api/media/ch1/item1/file')).toBe(true);
    expect(isSafeMediaSrc('https://archive.org/download/item/movie.mp4')).toBe(true);
    expect(isSafeMediaSrc('http://192.168.1.99:8096/Videos/1/stream.mp4')).toBe(true);
  });

  test('recusa traversal, rotas internas sensíveis, loopback e esquemas perigosos', () => {
    expect(isSafeMediaSrc('/api/../etc/passwd')).toBe(false);
    expect(isSafeMediaSrc('/api/sources/%2e%2e/backup')).toBe(false);
    expect(isSafeMediaSrc('/api/backup')).toBe(false);
    expect(isSafeMediaSrc('/api/credentials')).toBe(false);
    expect(isSafeMediaSrc('/api/library')).toBe(false);
    expect(isSafeMediaSrc('http://127.0.0.1:3000/api/backup')).toBe(false);
    expect(isSafeMediaSrc('http://localhost:3000/api/credentials')).toBe(false);
    expect(isSafeMediaSrc('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafeMediaSrc('//evil.com/video.mp4')).toBe(false);
    expect(isSafeMediaSrc('/etc/passwd')).toBe(false);
    expect(isSafeMediaSrc('file:///C:/video.mp4')).toBe(false);
    expect(isSafeMediaSrc('javascript:alert(1)')).toBe(false);
    expect(isSafeMediaSrc('https://user:pass@example.com/a.mp4')).toBe(false);
  });
});

describe('cast relay: sessões, proxy interno, cabeçalhos DLNA e encerramento', () => {
  test('serve mídia interna com Range e cabeçalhos DLNA, legenda VTT e página da TV escapada', async () => {
    const seenRanges: Array<string | null> = [];
    const relay = createCastRelay({
      hostname: '127.0.0.1',
      port: 0,
      internalFetch: (req) => {
        seenRanges.push(req.headers.get('range'));
        return new Response('video-bytes', {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': 'bytes 0-10/100',
          },
        });
      },
    });

    const session = relay.createSession({
      mediaSrc: '/api/sources/local/stream?id=1',
      title: 'Filme <Teste> & "TV"',
      subtitle: 'Canal Local',
      subtitleVtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOlá TV',
      startAt: 45,
    });

    // Token inválido ou rota desconhecida: 404.
    const badToken = await relay.handleRequest(new Request('http://192.168.1.10:9999/s/00000000000000000000000000000000/media'));
    expect(badToken.status).toBe(404);
    const badPath = await relay.handleRequest(new Request('http://192.168.1.10:9999/api/library'));
    expect(badPath.status).toBe(404);

    // Mídia com Range + cabeçalhos DLNA.
    const mediaRes = await relay.handleRequest(
      new Request(`http://192.168.1.10:9999/s/${session.token}/media`, { headers: { Range: 'bytes=0-10' } }),
    );
    expect(mediaRes.status).toBe(206);
    expect(seenRanges[0]).toBe('bytes=0-10');
    expect(mediaRes.headers.get('transferMode.dlna.org')).toBe('Streaming');
    expect(mediaRes.headers.get('accept-ranges')).toBe('bytes');
    expect(await mediaRes.text()).toBe('video-bytes');

    // Legenda WebVTT.
    const subRes = await relay.handleRequest(new Request(`http://192.168.1.10:9999/s/${session.token}/sub.vtt`));
    expect(subRes.status).toBe(200);
    expect(subRes.headers.get('content-type')).toContain('text/vtt');
    expect(await subRes.text()).toContain('Olá TV');

    // Página da TV escapada.
    const watchRes = await relay.handleRequest(new Request(`http://192.168.1.10:9999/s/${session.token}/watch`));
    expect(watchRes.status).toBe(200);
    const html = await watchRes.text();
    expect(html).toContain('Filme &lt;Teste&gt; &amp; &quot;TV&quot;');
    expect(html).toContain('data-start="45"');
    expect(html).toContain(`/s/${session.token}/sub.vtt`);

    // Sobe o socket real sob demanda e fecha ao remover a última sessão.
    const port = relay.ensureStarted();
    expect(port).toBeGreaterThan(0);
    expect(relay.port()).toBe(port);
    expect(relay.removeSession(session.id)).toBe(true);
    expect(relay.port()).toBeNull();
  });

  test('expira sessão inativa após o TTL', () => {
    let clock = 1_000_000;
    const relay = createCastRelay({
      internalFetch: () => new Response('ok'),
      ttlMs: 1000,
      now: () => clock,
    });
    const session = relay.createSession({ mediaSrc: '/api/sources/x/stream', title: 'Teste' });
    expect(relay.getSession(session.id)).toBeDefined();
    clock += 2000;
    expect(relay.getSession(session.id)).toBeUndefined();
  });

  test('bloqueia redirect externo para loopback/link-local e sanitiza Range inválido', async () => {
    const seen: Array<{ url: string; range: string | null }> = [];
    const relay = createCastRelay({
      internalFetch: () => new Response('ok'),
      externalFetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const h = new Headers(init?.headers);
        seen.push({ url, range: h.get('range') });
        if (url === 'https://cdn.example.com/evil.mp4') {
          return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } });
        }
        return new Response('ok', { status: 200 });
      }) as typeof fetch,
    });
    const evil = relay.createSession({ mediaSrc: 'https://cdn.example.com/evil.mp4', title: 'Redirect' });
    const blocked = await relay.handleRequest(
      new Request(`http://192.168.1.10:9999/s/${evil.token}/media`, { headers: { Range: 'bytes=0-1,2-3' } }),
    );
    expect(blocked.status).toBe(502);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.range).toBeNull();
  });
});
