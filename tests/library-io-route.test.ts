import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests, getDb } from '../src/server/db.ts';
import { CSV_MAX_BYTES, MAL_MAX_BYTES } from '../src/server/providers/library-io/common.ts';
import { listLibrary } from '../src/server/repo/library.ts';
import { libraryIoRoutes } from '../src/server/routes/library-io.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const HEADER = 'title,year,type,status,rating,current_season,current_episode,notes,tmdb_id,added_at';
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  libraryIoRoutes.request(path, { method: 'POST', body, headers });

describe('GET /api/library/export.csv', () => {
  test('devolve CSV com BOM, tipo texto UTF-8 e anexo com nome de arquivo', async () => {
    const res = await libraryIoRoutes.request('/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="nerd-watch-biblioteca\.csv"$/);
    expect((await res.text()).startsWith(`﻿${HEADER}\r\n`)).toBe(true);
  });
});

describe('POST /api/library/import.csv', () => {
  test('importa e devolve o relatório com contagens e erros por linha', async () => {
    const csv = `${HEADER}\r\nFilme Teste,2001,movie,want,,,,,321,\r\nLinha quebrada,,movie\r\n`;
    const res = await post('/import.csv', csv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ imported: 1, updated: 0, unchanged: 0, failed: 1 });
    expect(body.errors).toEqual([{ row: 3, message: expect.stringContaining('colunas') }]);
    expect(listLibrary(await getDb())).toHaveLength(1);
  });

  test('arquivo acima de 1 MiB é 413 e não grava nada', async () => {
    const big = `${HEADER}\r\n${'x'.repeat(CSV_MAX_BYTES + 1)}`;
    const res = await post('/import.csv', big);
    expect(res.status).toBe(413);
    expect(listLibrary(await getDb())).toEqual([]);
  });

  test('o teto vale mesmo sem Content-Length (corpo em stream)', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(CSV_MAX_BYTES / 2 + 1));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = await libraryIoRoutes.request('/import.csv', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(res.status).toBe(413);
  });

  test('arquivo que não é UTF-8 é 400', async () => {
    const res = await post('/import.csv', new Uint8Array([0x74, 0x69, 0x74, 0xff, 0xfe]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('UTF-8');
  });

  test('cabeçalho inválido é 400 com a mensagem da coluna faltando', async () => {
    const res = await post('/import.csv', 'titulo,tipo\r\nX,movie');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('status');
  });
});

describe('POST /api/library/import.mal', () => {
  const ALPHA = `<anime><series_animedb_id>1001</series_animedb_id><series_title>Anime Fictício</series_title><my_status>Completed</my_status><my_score>8</my_score></anime>`;

  test('happy path: 200 com as entradas sem correspondência offline listadas', async () => {
    const res = await post('/import.mal', `<?xml version="1.0"?><myanimelist>${ALPHA}</myanimelist>`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ entries: 1, imported: 0, unresolved: [{ malId: 1001, title: 'Anime Fictício', watchStatus: 'watched' }] });
  });

  test('DOCTYPE é 400 e nada é gravado', async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE myanimelist [<!ENTITY a "aaaa">]><myanimelist>${ALPHA}</myanimelist>`;
    const res = await post('/import.mal', xml);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('DOCTYPE');
    expect(listLibrary(await getDb())).toEqual([]);
  });

  test('arquivo acima de 5 MiB é 413, antes de parsear', async () => {
    const res = await post('/import.mal', ' '.repeat(MAL_MAX_BYTES + 1));
    expect(res.status).toBe(413);
  });
});
