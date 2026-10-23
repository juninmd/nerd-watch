import { describe, expect, test } from 'bun:test';
import {
  isShellRequest,
  isStaleShellCache,
  SHELL_CACHE_NAME,
  SHELL_CACHE_PREFIX,
} from '../src/client/pwa/shell-cache.ts';

const ORIGIN = 'http://127.0.0.1:7799';
const get = (path: string, extra: { method?: string; hasRange?: boolean; origin?: string } = {}) =>
  isShellRequest(
    { method: extra.method ?? 'GET', url: `${extra.origin ?? ORIGIN}${path}`, hasRange: extra.hasRange ?? false },
    ORIGIN,
  );

describe('isShellRequest: cacheia só a casca do app', () => {
  test('aceita a página, o bundle, o css e os ícones do PWA', () => {
    for (const path of ['/', '/index.html', '/app.js', '/styles.css', '/styles/tokens.css']) {
      expect(get(path)).toBe(true);
    }
    expect(get('/manifest.webmanifest')).toBe(true);
    expect(get('/icon.svg')).toBe(true);
  });

  test('nunca cacheia /api, nem o que tem cara de vídeo ou proxy dentro dela', () => {
    expect(get('/api/health')).toBe(false);
    expect(get('/api/playback/stream.mp4')).toBe(false);
    expect(get('/api/torrent/file/12/video.webm')).toBe(false);
    expect(get('/api/subtitles/file.srt')).toBe(false);
    expect(get('/api')).toBe(false);
  });

  test('nunca cacheia mídia fora de /api (extensão de vídeo/áudio fica de fora da allowlist)', () => {
    for (const path of ['/movie.mp4', '/clip.webm', '/film.mkv', '/track.mp3']) {
      expect(get(path)).toBe(false);
    }
  });

  test('requisição com Range nunca entra no cache, mesmo para um caminho de casca', () => {
    expect(get('/app.js', { hasRange: true })).toBe(false);
  });

  test('só GET: POST/PATCH/DELETE passam direto para a rede', () => {
    expect(get('/', { method: 'POST' })).toBe(false);
    expect(get('/app.js', { method: 'PUT' })).toBe(false);
  });

  test('só a própria origem: nenhuma URL de outro host é interceptada', () => {
    expect(get('/app.js', { origin: 'https://cdn.example.com' })).toBe(false);
  });
});

describe('isStaleShellCache: limpa só as versões antigas do próprio app', () => {
  test('a versão atual é preservada', () => {
    expect(SHELL_CACHE_NAME.startsWith(SHELL_CACHE_PREFIX)).toBe(true);
    expect(isStaleShellCache(SHELL_CACHE_NAME)).toBe(false);
  });

  test('caches de versões anteriores são marcados para remoção', () => {
    expect(isStaleShellCache(`${SHELL_CACHE_PREFIX}v0`)).toBe(true);
  });

  test('caches de outras aplicações na mesma origem não são tocados', () => {
    expect(isStaleShellCache('workbox-precache-v2')).toBe(false);
    expect(isStaleShellCache('some-other-app-v1')).toBe(false);
  });
});
