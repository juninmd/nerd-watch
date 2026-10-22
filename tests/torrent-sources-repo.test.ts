import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.ts';
import { getTorrentSource, saveTorrentSource } from '../src/server/repo/torrent-sources.ts';

/**
 * A origem do torrent é o que permite reabrir depois de um restart: se a migração não for idempotente
 * ou se regravar mudar `added_at`, o app perde a ordem dos itens ou não consegue reabrir nada.
 */

const scratch = mkdtempSync(join(tmpdir(), 'nerd-watch-torrent-sources-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const H = 'c3'.repeat(20);

describe('migração de torrent_sources', () => {
  test('é idempotente: abrir o mesmo arquivo de novo não falha nem apaga o que já foi gravado', () => {
    const path = join(scratch, 'idempotente.db');
    const first = openDb(path);
    saveTorrentSource(first, H, `magnet:?xt=urn:btih:${H}`, '2026-02-01T10:00:00.000Z');
    first.close();

    const second = openDb(path);
    expect(getTorrentSource(second, H)?.addedAt).toBe('2026-02-01T10:00:00.000Z');
    second.close();
  });

  test('cria a tabela com as colunas do contrato (infohash, magnet, added_at)', () => {
    const db = openDb(':memory:');
    const columns = db.query<{ name: string; notnull: number; pk: number }, []>('PRAGMA table_info(torrent_sources)').all();
    expect(columns.map((c) => c.name)).toEqual(['infohash', 'magnet', 'added_at']);
    expect(columns.find((c) => c.name === 'infohash')?.pk).toBe(1);
    expect(columns.find((c) => c.name === 'magnet')?.notnull).toBe(1);
    expect(columns.find((c) => c.name === 'added_at')?.notnull).toBe(1);
  });
});

describe('repo torrent-sources', () => {
  test('regravar a mesma origem não move added_at: a primeira importação é a que vale', () => {
    const db = openDb(':memory:');
    saveTorrentSource(db, H, `magnet:?xt=urn:btih:${H}`, '2026-01-01T00:00:00.000Z');
    saveTorrentSource(db, H, `magnet:?xt=urn:btih:${H}&dn=outro`, '2026-06-06T00:00:00.000Z');
    const row = getTorrentSource(db, H);
    expect(row?.addedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(row?.magnet).toBe(`magnet:?xt=urn:btih:${H}`);
  });

  test('infohash desconhecido devolve null em vez de uma origem vazia', () => {
    expect(getTorrentSource(openDb(':memory:'), 'd4'.repeat(20))).toBeNull();
  });

  test('a consulta é parametrizada: um infohash com aspas não quebra nem casa com outra linha', () => {
    const db = openDb(':memory:');
    saveTorrentSource(db, H, `magnet:?xt=urn:btih:${H}`, '2026-01-01T00:00:00.000Z');
    expect(getTorrentSource(db, "' OR '1'='1")).toBeNull();
  });
});
