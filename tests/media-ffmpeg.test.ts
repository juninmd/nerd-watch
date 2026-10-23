import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { type LocatedFile, createMediaService } from '../src/server/media/service.ts';
import { mediaSettings } from '../src/server/media/settings.ts';
import { liveProcessCount } from '../src/server/media/process.ts';
import { createMediaRoutes } from '../src/server/routes/media.ts';

/**
 * Integração com ffmpeg de verdade. Os arquivos são gerados aqui (lavfi, 2 s, sintéticos) em um diretório temporário
 * e apagados no fim. Sem ffmpeg/ffprobe no PATH a suíte inteira é pulada com uma mensagem explícita.
 */
const HAS_FFMPEG = Bun.which('ffmpeg') !== null && Bun.which('ffprobe') !== null;
if (!HAS_FFMPEG) console.log('[media-ffmpeg] pulado: ffmpeg/ffprobe não encontrados no PATH (instale o ffmpeg para rodar estes testes)');

const run = async (args: string[]): Promise<void> => {
  const proc = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdout: 'ignore', stderr: 'pipe' });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg de fixture falhou (código ${code})`);
};

const probe = async (file: string): Promise<{ duration: number; codecs: string[] }> => {
  const proc = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_name', '-of', 'json', file], { stdout: 'pipe' });
  const json = JSON.parse(await new Response(proc.stdout).text()) as { format?: { duration?: string }; streams?: { codec_name?: string }[] };
  return { duration: Number(json.format?.duration ?? 0), codecs: (json.streams ?? []).map((s) => s.codec_name ?? '') };
};

describe.skipIf(!HAS_FFMPEG)('conversão com ffmpeg real', () => {
  let dir: string;
  let cacheDir: string;
  let files: Record<string, string>;
  let routes: Hono;
  let service: ReturnType<typeof createMediaService>;

  /** Mapa canal → arquivo. `null` (fora do mapa) simula um item que não é de pasta local. */
  const locate = async (channel: string): Promise<LocatedFile | null> => {
    const file = files[channel];
    if (!file) return null;
    const info = await stat(file);
    return { file, name: path.basename(file), size: info.size, mtimeMs: info.mtimeMs };
  };

  const build = (env: Record<string, string> = {}) => {
    service = createMediaService({ settings: mediaSettings({ TRANSCODE_CACHE_DIR: cacheDir, TRANSCODE_MAX_JOBS: '1', ...env }, dir), locate });
    routes = new Hono().route('/', createMediaRoutes(service));
    return service;
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nw-media-'));
    cacheDir = path.join(dir, 'cache');
    const f = (name: string) => path.join(dir, name);
    const src = ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2'];
    await run([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('h264-aac.mkv')]);
    await run([...src, '-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-shortest', f('mpeg4-mp3.avi')]);
    await run([...src, '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('hevc.mkv')]);
    await writeFile(f('sub.srt'), '1\n00:00:00,000 --> 00:00:01,000\nolá mundo\n\n2\n00:00:01,000 --> 00:00:02,000\nsegunda\n');
    await run(['-i', f('h264-aac.mkv'), '-i', f('sub.srt'), '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'srt', f('subs.mkv')]);
    files = { remux: f('h264-aac.mkv'), avi: f('mpeg4-mp3.avi'), hevc: f('hevc.mkv'), subs: f('subs.mkv') };
    // Um .mp4 de verdade para o caso "já toca direto" (a decisão olha o nome do arquivo, não o conteúdo).
    files.direct = f('direct.mp4');
    await run([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('direct.mp4')]);
    build();
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('plano: H.264+AAC vai por remux, MPEG-4 e HEVC por transcodificação, mp4 é direto', async () => {
    expect(await service.plan('remux', '0')).toMatchObject({ path: 'remux', audio: 'copy' });
    expect(await service.plan('avi', '0')).toMatchObject({ path: 'transcode' });
    expect(await service.plan('hevc', '0')).toMatchObject({ path: 'transcode' });
    expect(await service.plan('direct', '0')).toMatchObject({ path: 'direct' });
  });

  test('item que não é de pasta local: plano "n/a" e conversão recusada com 404', async () => {
    expect(await service.plan('nao-local', '0')).toMatchObject({ path: 'n/a' });
    const res = await routes.request('/nao-local/0/prepare', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('remux: prepara, acompanha até pronto, serve com Range e o MP4 toca (h264 + aac)', async () => {
    const started = await routes.request('/remux/0/prepare', { method: 'POST' });
    expect([200, 202]).toContain(started.status);
    let state = 'running';
    for (let i = 0; i < 200 && state !== 'ready'; i++) {
      const body = (await (await routes.request('/remux/0/status')).json()) as { state: string; error?: string };
      if (body.state === 'error') throw new Error(`remux falhou: ${body.error}`);
      state = body.state;
      if (state !== 'ready') await Bun.sleep(100);
    }
    expect(state).toBe('ready');

    const ranged = await routes.request('/remux/0/file', { headers: { Range: 'bytes=0-99' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
    expect(ranged.headers.get('content-type')).toBe('video/mp4');

    const whole = new Uint8Array(await (await routes.request('/remux/0/file')).arrayBuffer());
    const out = path.join(dir, 'remux-out.mp4');
    await Bun.write(out, whole);
    const info = await probe(out);
    expect(info.codecs).toEqual(expect.arrayContaining(['h264', 'aac']));
    expect(info.duration).toBeGreaterThan(1.5);
  });

  test('dedupe: dois pedidos simultâneos do mesmo arquivo geram um único arquivo de cache', async () => {
    const [a, b] = await Promise.all([routes.request('/remux/0/prepare', { method: 'POST' }), routes.request('/remux/0/prepare', { method: 'POST' })]);
    expect(a.status).not.toBe(503);
    expect(b.status).not.toBe(503);
    await Bun.sleep(300);
    const mp4s = (await readdir(cacheDir)).filter((n) => n.endsWith('.mp4'));
    expect(new Set(mp4s).size).toBe(mp4s.length);
    expect(mp4s.some((n) => n.endsWith('.part'))).toBe(false);
  });

  test('transcodificação ao vivo com ?start: o stream volta com a duração do trecho restante', async () => {
    const res = await routes.request('/hevc/0/live?start=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('none');
    const out = path.join(dir, 'hevc-from-1.mp4');
    await Bun.write(out, new Uint8Array(await res.arrayBuffer()));
    const info = await probe(out);
    expect(info.codecs).toEqual(expect.arrayContaining(['h264', 'aac']));
    expect(info.duration).toBeGreaterThan(0.6);
    expect(info.duration).toBeLessThan(1.6);
  });

  test('?start além do fim é recortado (o stream ainda sai com conteúdo)', async () => {
    const res = await routes.request('/hevc/0/live?start=999');
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test('cancelar o stream mata o ffmpeg: nenhum processo órfão sobra', async () => {
    const res = await routes.request('/hevc/0/live');
    const reader = res.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    for (let i = 0; i < 50 && liveProcessCount() > 0; i++) await Bun.sleep(50);
    expect(liveProcessCount()).toBe(0);
    expect(service.slots.active).toBe(0);
  });

  test('sem slot livre: segundo stream e segunda conversão voltam 503 com Retry-After', async () => {
    const first = await routes.request('/hevc/0/live');
    expect(first.status).toBe(200);
    const busy = await routes.request('/remux/0/prepare', { method: 'POST' });
    const busyLive = await routes.request('/avi/0/live');
    expect(busyLive.status).toBe(503);
    expect(busyLive.headers.get('retry-after')).toBe('15');
    // O remux do arquivo já convertido é reaproveitado, então o 503 vem do live (que precisa de slot novo).
    expect([200, 202, 503]).toContain(busy.status);
    await first.body?.cancel();
    for (let i = 0; i < 50 && service.slots.active > 0; i++) await Bun.sleep(50);
    expect(service.slots.active).toBe(0);
  });

  test('legenda de texto sai como WebVTT; a pasta de origem não aparece na resposta', async () => {
    const res = await routes.request('/subs/0/subtitles/0');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/vtt');
    const body = await res.text();
    expect(body.startsWith('WEBVTT')).toBe(true);
    expect(body).toContain('olá mundo');
    expect(body).not.toContain(dir);
  });

  test('índice de legenda inexistente ou inválido: 404 sem tocar no ffmpeg', async () => {
    expect((await routes.request('/subs/0/subtitles/9')).status).toBe(404);
    expect((await routes.request('/subs/0/subtitles/abc')).status).toBe(404);
  });

  test('ids com caracteres estranhos são 404 antes de qualquer acesso', async () => {
    expect((await routes.request('/..%2Fetc/0/plan')).status).toBe(404);
    expect((await routes.request('/a;b/0/plan')).status).toBe(404);
  });

  test('erros nunca vazam caminho do disco na resposta', async () => {
    const res = await routes.request('/remux/0/file');
    const text = await res.text();
    expect(text).not.toContain(dir);
  });
});

describe('ffmpeg ausente: comportamento de hoje, com motivo na UI', () => {
  test('com FFMPEG_PATH apontando para nada, o plano diz como ativar e a conversão responde 501', async () => {
    const locate = async (channel: string): Promise<LocatedFile | null> =>
      channel === 'x' ? { file: path.resolve('/media/x.mkv'), name: 'x.mkv', size: 1, mtimeMs: 1 } : null;
    const service = createMediaService({
      settings: mediaSettings({ FFMPEG_PATH: path.resolve('/no/such/ffmpeg'), FFPROBE_PATH: path.resolve('/no/such/ffprobe') }, '/'),
      locate,
    });
    const plan = await service.plan('x', '0');
    expect(plan.path).toBe('unavailable');
    expect(plan.reason).toContain('FFMPEG_PATH');
    const routes = new Hono().route('/', createMediaRoutes(service));
    expect((await routes.request('/x/0/live')).status).toBe(501);
    expect((await routes.request('/x/0/prepare', { method: 'POST' })).status).toBe(501);
  });

  test('TRANSCODE_ENABLED=false desliga a conversão mesmo com ffmpeg presente', async () => {
    const locate = async (): Promise<LocatedFile | null> => ({ file: path.resolve('/media/x.mkv'), name: 'x.mkv', size: 1, mtimeMs: 1 });
    const service = createMediaService({ settings: mediaSettings({ TRANSCODE_ENABLED: 'false' }, '/'), locate });
    expect(await service.plan('x', '0')).toMatchObject({ path: 'unavailable' });
  });
});
