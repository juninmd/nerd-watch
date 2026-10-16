import { describe, expect, test } from 'bun:test';
import { parseRange, torrentRoutes } from '../src/server/routes/torrent.ts';
import {
  TorrentUntrustedSourceError,
  archiveTorrentUrl,
  assertArchiveOnlySources,
  paddedIterEnd,
  streamExactBytes,
} from '../src/server/torrent/engine.ts';

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

describe('parseRange', () => {
  const TOTAL = 1000;

  test('sem header, serve o arquivo inteiro (200)', () => {
    expect(parseRange(undefined, TOTAL)).toBeNull();
  });

  test('range fechado', () => {
    expect(parseRange('bytes=0-99', TOTAL)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-199', TOTAL)).toEqual({ start: 100, end: 199 });
  });

  test('range aberto no fim vai até o último byte', () => {
    expect(parseRange('bytes=500-', TOTAL)).toEqual({ start: 500, end: TOTAL - 1 });
    expect(parseRange('bytes=0-', TOTAL)).toEqual({ start: 0, end: TOTAL - 1 });
  });

  test('range de sufixo devolve os últimos N bytes', () => {
    expect(parseRange('bytes=-500', TOTAL)).toEqual({ start: 500, end: TOTAL - 1 });
    expect(parseRange('bytes=-1', TOTAL)).toEqual({ start: TOTAL - 1, end: TOTAL - 1 });
  });

  test('sufixo igual ou maior que o arquivo devolve o arquivo inteiro', () => {
    expect(parseRange('bytes=-1000', TOTAL)).toEqual({ start: 0, end: TOTAL - 1 });
    expect(parseRange('bytes=-99999', TOTAL)).toEqual({ start: 0, end: TOTAL - 1 });
  });

  test('range de 1 byte no offset 0 é expressável (o caso que o webtorrent trata como EOF)', () => {
    expect(parseRange('bytes=0-0', TOTAL)).toEqual({ start: 0, end: 0 });
  });

  test('fim além do EOF é truncado em vez de estourar', () => {
    expect(parseRange('bytes=900-99999', TOTAL)).toEqual({ start: 900, end: TOTAL - 1 });
  });

  test('range invertido não é satisfazível (seria 206 com Content-Length negativo)', () => {
    expect(parseRange('bytes=500-100', TOTAL)).toBe('unsatisfiable');
    expect(parseRange('bytes=999-0', TOTAL)).toBe('unsatisfiable');
  });

  test('início além do EOF não é satisfazível', () => {
    expect(parseRange('bytes=1000-1200', TOTAL)).toBe('unsatisfiable');
    expect(parseRange('bytes=5000-', TOTAL)).toBe('unsatisfiable');
  });

  test('sufixo zero não é satisfazível', () => {
    expect(parseRange('bytes=-0', TOTAL)).toBe('unsatisfiable');
  });

  test('sufixo em recurso vazio não é satisfazível', () => {
    expect(parseRange('bytes=-100', 0)).toBe('unsatisfiable');
  });

  test('header inválido cai em "sem range" em vez de dar erro', () => {
    expect(parseRange('bytes=abc-def', TOTAL)).toBeNull();
    expect(parseRange('items=0-10', TOTAL)).toBeNull();
    expect(parseRange('bytes=0-10,20-30', TOTAL)).toBeNull();
    expect(parseRange('bytes=-', TOTAL)).toBeNull();
  });
});

describe('paddedIterEnd', () => {
  test('nunca devolve um `end` falsy (o webtorrent leria "até o fim do arquivo")', () => {
    expect(paddedIterEnd(0, 0)).toBe(1);
    expect(paddedIterEnd(0, 1)).toBe(1);
  });

  test('preserva o `end` pedido quando ele já é maior que start', () => {
    expect(paddedIterEnd(0, 262143)).toBe(262143);
    expect(paddedIterEnd(500, 999)).toBe(999);
  });
});

describe('streamExactBytes', () => {
  const fakeIterator = (chunks: Uint8Array[]): AsyncIterator<Uint8Array> & { returned: boolean } => {
    let i = 0;
    const state = { returned: false };
    return {
      get returned() {
        return state.returned;
      },
      async next() {
        if (i >= chunks.length) return { value: undefined, done: true };
        // biome-ignore lint/style/noNonNullAssertion: índice checado acima
        return { value: chunks[i++]!, done: false };
      },
      async return() {
        state.returned = true;
        return { value: undefined, done: true };
      },
    };
  };

  const readAll = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };

  test('devolve exatamente N bytes mesmo quando o chunk é maior que o pedido', async () => {
    // O chunk de 10 bytes com um pedido de 1 byte é o caso real do `bytes=0-0`.
    const iterator = fakeIterator([new Uint8Array(10).fill(7)]);
    const body = await readAll(streamExactBytes(iterator, 1, () => {}));
    expect(body.length).toBe(1);
    expect(body[0]).toBe(7);
  });

  test('para de ler assim que atinge o pedido, mesmo com chunks sobrando', async () => {
    const iterator = fakeIterator([new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)]);
    const body = await readAll(streamExactBytes(iterator, 6, () => {}));
    expect(body.length).toBe(6);
  });

  test('devolve menos que o pedido (sem estourar) quando o arquivo acaba antes', async () => {
    const iterator = fakeIterator([new Uint8Array(3)]);
    const body = await readAll(streamExactBytes(iterator, 100, () => {}));
    expect(body.length).toBe(3);
  });

  test('devolve o iterador ao terminar (liberando os pedaços do webtorrent)', async () => {
    const iterator = fakeIterator([new Uint8Array(10)]);
    await readAll(streamExactBytes(iterator, 10, () => {}));
    expect(iterator.returned).toBe(true);
  });

  test('devolve o iterador também no cancelamento, e chama onDone uma vez só', async () => {
    let doneCalls = 0;
    const iterator = fakeIterator([new Uint8Array(10), new Uint8Array(10)]);
    const stream = streamExactBytes(iterator, 100, () => {
      doneCalls++;
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(iterator.returned).toBe(true);
    expect(doneCalls).toBe(1);
  });
});

describe('assertArchiveOnlySources', () => {
  test('aceita o que os itens reais da Archive declaram', () => {
    expect(() =>
      assertArchiveOnlySources(
        ['http://bt1.archive.org:6969/announce', 'http://bt2.archive.org:6969/announce'],
        ['https://archive.org/download/', 'http://ia601306.us.archive.org/19/items/'],
      ),
    ).not.toThrow();
  });

  test('aceita torrent sem announce nem url-list', () => {
    expect(() => assertArchiveOnlySources([], [])).not.toThrow();
  });

  test('recusa host de terceiro', () => {
    expect(() => assertArchiveOnlySources(['http://tracker.evil.com/announce'], [])).toThrow(TorrentUntrustedSourceError);
    expect(() => assertArchiveOnlySources([], ['http://evil.com/items/'])).toThrow(TorrentUntrustedSourceError);
  });

  test('recusa loopback e IP literal (é para onde um beacon apontaria)', () => {
    expect(() => assertArchiveOnlySources(['http://127.0.0.1:9/announce'], [])).toThrow(TorrentUntrustedSourceError);
    expect(() => assertArchiveOnlySources(['http://localhost/announce'], [])).toThrow(TorrentUntrustedSourceError);
    expect(() => assertArchiveOnlySources([], ['http://169.254.169.254/latest/meta-data'])).toThrow(TorrentUntrustedSourceError);
  });

  test('não se deixa enganar por userinfo, prefixo ou sufixo', () => {
    for (const evil of [
      'http://archive.org@evil.com/announce',
      'http://notarchive.org/announce',
      'http://archive.org.evil.com/announce',
      'http://evil.com/archive.org/announce',
    ]) {
      expect(() => assertArchiveOnlySources([evil], [])).toThrow(TorrentUntrustedSourceError);
    }
  });

  test('aceita subdomínio legítimo e ignora caixa', () => {
    expect(() => assertArchiveOnlySources(['HTTP://BT1.ARCHIVE.ORG:6969/announce'], [])).not.toThrow();
  });
});

describe('POST /api/torrent/open', () => {
  test('400 sem identifier', async () => {
    const res = await torrentRoutes.request('/open', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  test('400 quando identifier não é string (evita 500 no handler)', async () => {
    for (const identifier of [123, ['a'], true, { a: 1 }]) {
      const res = await torrentRoutes.request('/open', { method: 'POST', body: JSON.stringify({ identifier }) });
      expect(res.status).toBe(400);
    }
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
