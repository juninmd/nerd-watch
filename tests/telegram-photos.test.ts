import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadPhoto, photoStore, readPhoto, readThumb, savePhoto, saveThumb } from '../src/server/telegram-photos.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const originalDir = photoStore.dir;
const originalFetch = globalThis.fetch;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nw-photos-'));
  photoStore.dir = () => dir;
});

afterEach(() => {
  photoStore.dir = originalDir;
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
});

describe('savePhoto / readPhoto', () => {
  test('guarda e devolve a foto com o tipo detectado pelos bytes', async () => {
    expect(await savePhoto(ID, PNG)).toBe('image/png');
    expect(await readPhoto(ID)).toEqual({ bytes: expect.any(Uint8Array), type: 'image/png' });
    expect(await savePhoto(ID, JPG)).toBe('image/jpeg');
  });

  test('recusa o que não é imagem, vazio, grande demais ou com id que sairia da pasta', async () => {
    expect(await savePhoto(ID, new TextEncoder().encode('<html>não sou imagem</html>'))).toBeNull();
    expect(await savePhoto(ID, new Uint8Array(0))).toBeNull();
    expect(await savePhoto(ID, new Uint8Array([...JPG, ...new Uint8Array(2 * 1024 * 1024)]))).toBeNull();
    expect(await savePhoto('../../etc/passwd', PNG)).toBeNull();
    expect(await readPhoto('../../etc/passwd')).toBeNull();
  });

  test('sem pasta configurada (banco em memória) não grava nada', async () => {
    photoStore.dir = () => null;
    expect(await savePhoto(ID, PNG)).toBeNull();
    expect(await readPhoto(ID)).toBeNull();
  });
});

describe('downloadPhoto', () => {
  test('não faz requisição para hosts fora do Telegram', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(PNG);
    }) as unknown as typeof fetch;
    expect(await downloadPhoto('https://evil.example/a.png')).toBeNull();
    expect(called).toBe(false);
  });

  test('baixa de um CDN do Telegram e devolve null em resposta de erro', async () => {
    globalThis.fetch = (async () => new Response(PNG)) as unknown as typeof fetch;
    expect(await downloadPhoto('https://cdn1.telesco.pe/file/a.png')).toEqual(PNG);
    globalThis.fetch = (async () => new Response('x', { status: 404 })) as unknown as typeof fetch;
    expect(await downloadPhoto('https://cdn1.telesco.pe/file/a.png')).toBeNull();
  });
});

describe('saveThumb / readThumb', () => {
  test('guarda a miniatura de um vídeo e a devolve', async () => {
    expect(await saveThumb(ID, '100', JPG)).toBe(true);
    expect(await readThumb(ID, '100')).toEqual({ bytes: expect.any(Uint8Array), type: 'image/jpeg' });
    expect(await readThumb(ID, '101')).toBeNull();
  });

  test('recusa ids que sairiam da pasta, bytes que não são imagem e miniaturas grandes demais', async () => {
    expect(await saveThumb('../x', '100', JPG)).toBe(false);
    expect(await saveThumb(ID, '../100', JPG)).toBe(false);
    expect(await saveThumb(ID, '100', new TextEncoder().encode('<html>'))).toBe(false);
    expect(await saveThumb(ID, '100', new Uint8Array([...JPG, ...new Uint8Array(2 * 1024 * 1024)]))).toBe(false);
    expect(await readThumb(ID, '../100')).toBeNull();
  });
});
