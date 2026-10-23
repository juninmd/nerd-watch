import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { binaryStatus } from '../src/server/media/binaries.ts';
import { cacheKey, enforceCacheLimit, planEvictions, removeOrphanParts } from '../src/server/media/cache.ts';
import { mediaSettings } from '../src/server/media/settings.ts';

describe('LRU do cache: planEvictions', () => {
  const entry = (name: string, size: number, mtimeMs: number) => ({ name, size, mtimeMs });

  test('cabe no teto: nada é apagado', () => {
    expect(planEvictions([entry('a', 10, 1), entry('b', 10, 2)], 20, new Set())).toEqual([]);
  });

  test('apaga do mais antigo até caber, preservando o recente', () => {
    const victims = planEvictions([entry('old', 10, 1), entry('mid', 10, 2), entry('new', 10, 3)], 15, new Set());
    expect(victims).toEqual(['old', 'mid']);
  });

  test('o que está em uso nunca é apagado, mesmo sendo o mais antigo', () => {
    const victims = planEvictions([entry('busy', 10, 1), entry('idle', 10, 2)], 10, new Set(['busy']));
    expect(victims).toEqual(['idle']);
  });

  test('se tudo está em uso, para sem apagar (estouro temporário, não remoção de algo ativo)', () => {
    expect(planEvictions([entry('a', 10, 1), entry('b', 10, 2)], 5, new Set(['a', 'b']))).toEqual([]);
  });

  test('empate de mtime é determinístico (pelo nome)', () => {
    expect(planEvictions([entry('b', 10, 1), entry('a', 10, 1)], 10, new Set())).toEqual(['a']);
  });
});

describe('cache em disco', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nw-cache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const key = (c: string) => `${c.repeat(40)}.mp4`;

  test('enforceCacheLimit apaga pelo LRU real e preserva o em uso', async () => {
    const size = 1000;
    const names = [key('1'), key('2'), key('3')];
    for (const [i, name] of names.entries()) {
      await writeFile(path.join(dir, name), Buffer.alloc(size));
      const when = new Date(Date.now() - (names.length - i) * 60_000);
      await utimes(path.join(dir, name), when, when);
    }
    const removed = await enforceCacheLimit(dir, 2000, new Set([key('1')]));
    expect(removed).toEqual([key('2')]);
    expect((await readdir(dir)).sort()).toEqual([key('1'), key('3')].sort());
  });

  test('arquivos que não são do cache nunca são apagados, mesmo estourando o teto', async () => {
    // Um TRANSCODE_CACHE_DIR apontado para uma pasta de vídeos não pode perder os vídeos do usuário.
    await writeFile(path.join(dir, 'filme-original.mp4'), Buffer.alloc(5000));
    await writeFile(path.join(dir, key('4')), Buffer.alloc(5000));
    expect(await enforceCacheLimit(dir, 1000, new Set())).toEqual([key('4')]);
    expect(await readdir(dir)).toEqual(['filme-original.mp4']);
  });

  test('removeOrphanParts limpa só os *.part gerados e deixa o resto', async () => {
    await writeFile(path.join(dir, `${'5'.repeat(40)}.mp4.part`), 'a');
    await writeFile(path.join(dir, 'anotacoes.part'), 'keep');
    await writeFile(path.join(dir, key('6')), 'b');
    expect(await removeOrphanParts(dir)).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(['anotacoes.part', key('6')].sort());
  });

  test('removeOrphanParts em diretório inexistente não cria nada nem falha', async () => {
    const missing = path.join(dir, 'nao-existe');
    expect(await removeOrphanParts(missing)).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('cacheKey', () => {
  test('é estável para as mesmas partes e não expõe o caminho de origem', () => {
    const a = cacheKey(['/media/secret/ep.mkv', 10, 1.5, 'remux']);
    expect(cacheKey(['/media/secret/ep.mkv', 10, 1.5, 'remux'])).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toContain('secret');
  });

  test('muda quando o arquivo muda (tamanho ou mtime), então o cache não serve versão velha', () => {
    expect(cacheKey(['/m/ep.mkv', 10, 1])).not.toBe(cacheKey(['/m/ep.mkv', 11, 1]));
    expect(cacheKey(['/m/ep.mkv', 10, 1])).not.toBe(cacheKey(['/m/ep.mkv', 10, 2]));
  });
});

describe('mediaSettings: ambiente', () => {
  const CWD = path.resolve('/srv/app');

  test('padrões seguros quando nada é definido', () => {
    const s = mediaSettings({}, CWD);
    expect(s.mode).toBe('auto');
    expect(s.maxJobs).toBe(1);
    expect(s.cacheDir).toBe(path.resolve(CWD, 'data/media-cache'));
    expect(s.cacheMaxBytes).toBe(4096 * 1024 * 1024);
    expect(s.idleMs).toBe(60_000);
    expect(s.audioLangs).toEqual(['por', 'pt', 'eng', 'en']);
  });

  test('valores inválidos voltam ao padrão, nunca viram NaN nem desligam um teto', () => {
    const s = mediaSettings({ TRANSCODE_MAX_JOBS: '0', TRANSCODE_IDLE_SECONDS: 'abc', TRANSCODE_CACHE_MAX_MB: '-1', TRANSCODE_ENABLED: 'talvez' }, CWD);
    expect(s.maxJobs).toBe(1);
    expect(s.idleMs).toBe(60_000);
    expect(s.cacheMaxBytes).toBe(4096 * 1024 * 1024);
    expect(s.mode).toBe('auto');
    expect(Number.isNaN(s.maxJobs + s.idleMs + s.cacheMaxBytes)).toBe(false);
  });

  test('TRANSCODE_ENABLED aceita false em qualquer caixa', () => {
    expect(mediaSettings({ TRANSCODE_ENABLED: 'FALSE' }, CWD).mode).toBe('false');
  });

  test('o teto de jobs tem máximo; idioma e caminho do cache são normalizados', () => {
    const s = mediaSettings({ TRANSCODE_MAX_JOBS: '99', TRANSCODE_AUDIO_LANGS: ' POR , eng ,', TRANSCODE_CACHE_DIR: '  ' }, CWD);
    expect(s.maxJobs).toBe(1);
    expect(s.audioLangs).toEqual(['por', 'eng']);
    expect(s.cacheDir).toBe(path.resolve(CWD, 'data/media-cache'));
  });
});

describe('binaryStatus: ffmpeg opcional', () => {
  const settings = (over: Partial<ReturnType<typeof mediaSettings>> = {}) => ({ ...mediaSettings({}, '/'), ...over });
  const found = (bin: string) => `/usr/bin/${bin}`;

  test('acha ffmpeg e ffprobe no PATH', () => {
    expect(binaryStatus(settings(), found)).toEqual({ ok: true, bins: { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' } });
  });

  test('sem binário, a razão diz como ativar', () => {
    const status = binaryStatus(settings(), () => null);
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.reason).toContain('FFMPEG_PATH');
  });

  test('TRANSCODE_ENABLED=false desliga mesmo com binário presente', () => {
    const status = binaryStatus(settings({ mode: 'false' }), found);
    expect(status.ok).toBe(false);
  });

  test('FFMPEG_PATH apontando para arquivo inexistente não cai no PATH silenciosamente', () => {
    const status = binaryStatus(settings({ ffmpegPath: path.resolve('/definitely/not/here/ffmpeg') }), found);
    expect(status.ok).toBe(false);
  });
});
