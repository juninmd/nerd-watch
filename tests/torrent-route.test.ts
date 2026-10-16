import { describe, expect, test } from 'bun:test';
import { torrentRoutes } from '../src/server/routes/torrent.ts';
import { archiveTorrentUrl } from '../src/server/torrent/engine.ts';

/**
 * A allowlist de identifier é a fronteira que mantém esta feature no acervo livre: se ela
 * deixar passar qualquer coisa, o endpoint vira um player de magnet arbitrário. Por isso os
 * casos de rejeição aqui são tão importantes quanto os de aceitação.
 */
describe('archiveTorrentUrl', () => {
  test('monta a URL do torrent oficial a partir de um identifier normal', () => {
    expect(archiveTorrentUrl('Sita_Sings_the_Blues')).toBe(
      'https://archive.org/download/Sita_Sings_the_Blues/Sita_Sings_the_Blues_archive.torrent',
    );
  });

  test('aceita os caracteres que a Archive realmente usa', () => {
    expect(archiveTorrentUrl('house_on_haunted_hill_ipod')).toBeTruthy();
    expect(archiveTorrentUrl('TheFastandtheFuriousJohnIreland1954goofyrip')).toBeTruthy();
  });

  test('recusa travessia de diretório e esquema embutido', () => {
    expect(archiveTorrentUrl('../../etc/passwd')).toBeNull();
    expect(archiveTorrentUrl('a/../b')).toBeNull();
    expect(archiveTorrentUrl('https://exemplo.com/x.torrent')).toBeNull();
    expect(archiveTorrentUrl('a/b')).toBeNull();
  });

  test('recusa vazio, espaços, query/fragmento e caracteres de controle', () => {
    expect(archiveTorrentUrl('')).toBeNull();
    expect(archiveTorrentUrl(' item com espaço')).toBeNull();
    expect(archiveTorrentUrl('item?x=1')).toBeNull();
    expect(archiveTorrentUrl('item#frag')).toBeNull();
    expect(archiveTorrentUrl('item\n')).toBeNull();
  });

  test('recusa identifier absurdamente longo', () => {
    expect(archiveTorrentUrl('a'.repeat(101))).toBeNull();
  });
});

describe('POST /api/torrent/open', () => {
  test('400 sem identifier', async () => {
    const res = await torrentRoutes.request('/open', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  test('400 com identifier inválido, sem tocar a rede', async () => {
    const res = await torrentRoutes.request('/open', {
      method: 'POST',
      body: JSON.stringify({ identifier: '../../etc/passwd' }),
    });
    expect(res.status).toBe(400);
  });

  test('400 com fileIndex não inteiro', async () => {
    const res = await torrentRoutes.request('/open', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'algum_item', fileIndex: 'dois' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET/DELETE /api/torrent/:infoHash', () => {
  test('404 no status de um torrent que não está aberto', async () => {
    const res = await torrentRoutes.request('/deadbeef');
    expect(res.status).toBe(404);
  });

  test('404 ao fechar um torrent que não está aberto', async () => {
    const res = await torrentRoutes.request('/deadbeef', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('404 ao pedir stream de um torrent que não está aberto', async () => {
    const res = await torrentRoutes.request('/deadbeef/stream/0');
    expect(res.status).toBe(404);
  });

  test('404 quando o índice do arquivo não é um número', async () => {
    const res = await torrentRoutes.request('/deadbeef/stream/abc');
    expect(res.status).toBe(404);
  });
});
