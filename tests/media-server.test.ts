import { describe, expect, test } from 'bun:test';
import { MAX_ITEMS, THUMB_MAX_BYTES, collectPages, durationSeconds, episodeCaption, readCapped, safeRange, serverPath, serverUrlProblem } from '../src/server/providers/sources/media-server.ts';

const PART_KEY = /^\/library\/parts\/\d+\/\d+\/[^?#\\]+$/;

describe('serverUrlProblem', () => {
  test('aceita o servidor da LAN (IP privado é o uso normal)', () => {
    expect(serverUrlProblem('http://192.168.0.10:8096')).toBeNull();
    expect(serverUrlProblem('https://midia.example.net/jellyfin')).toBeNull();
  });

  test.each([
    ['ftp://192.168.0.10', 'protocolo'],
    ['javascript:alert(1)', 'protocolo'],
    ['http://fake-user:fake-pass@192.168.0.10:8096', 'usuário e senha'],
    ['http://192.168.0.10:8096/?api_key=x', 'query'],
    ['não é url', 'endereço completo'],
  ])('rejeita %s', (value) => {
    expect(serverUrlProblem(value)).not.toBeNull();
  });
});

describe('serverPath (caminho que o servidor devolveu)', () => {
  const pattern = PART_KEY;

  test('aceita o caminho de parte normal, inclusive nome com espaço e acento', () => {
    expect(serverPath('/library/parts/46618/1389985872/file.mkv', pattern)).toBe('/library/parts/46618/1389985872/file.mkv');
    expect(serverPath('/library/parts/1/2/Bleach - 09 [1080p] Ação.mp4', pattern)).not.toBeNull();
  });

  test.each([
    ['//evil.example/library/parts/1/2/x.mkv', 'host relativo ao protocolo'],
    ['http://evil.example/library/parts/1/2/x.mkv', 'URL absoluta'],
    ['/library/parts/1/2/../../../../system', 'escape por ..'],
    ['/library/parts/1/2/a/../../x.mkv', 'escape por .. no meio'],
    ['/library/parts/1/2/x.mkv?token=leak', 'query string'],
    ['/library/parts/1/2/x\r\nX-Injected: 1', 'quebra de linha'],
    ['/library/parts/1/2/%2e%2e/%2e%2e/identity', 'dot-segment codificado'],
    ['/library/parts/1/2/%2E%2E%2Fsecret.mkv', 'barra codificada em maiúsculas'],
    ['/library/metadata/1', 'outro caminho da API'],
  ])('rejeita %s (%s)', (raw) => {
    expect(serverPath(raw, pattern)).toBeNull();
  });

  test('não aceita valor que não é texto', () => {
    expect(serverPath(undefined, pattern)).toBeNull();
    expect(serverPath({ key: '/library/parts/1/2/x.mkv' }, pattern)).toBeNull();
  });
});

describe('safeRange', () => {
  test('repassa só bytes=a-b; qualquer outra coisa some em vez de chegar ao servidor', () => {
    expect(safeRange('bytes=0-1023')).toBe('bytes=0-1023');
    expect(safeRange('bytes=-500')).toBe('bytes=-500');
    expect(safeRange('bytes=0-1,3-4')).toBeUndefined();
    expect(safeRange('bytes=0-1\r\nX-Injected: 1')).toBeUndefined();
    expect(safeRange(undefined)).toBeUndefined();
  });
});

describe('collectPages', () => {
  test('junta todas as páginas até o total informado pelo servidor', async () => {
    const calls: Array<[number, number]> = [];
    const items = await collectPages(async (start, size) => {
      calls.push([start, size]);
      const slice = Array.from({ length: Math.min(size, 450 - start) }, (_, i) => start + i);
      return { items: slice, total: 450 };
    });
    expect(items).toHaveLength(450);
    expect(calls).toEqual([
      [0, 200],
      [200, 200],
      [400, 100],
    ]);
  });

  test('nunca passa do teto, mesmo com um catálogo maior: 500 itens em no máximo três páginas', async () => {
    let requests = 0;
    const items = await collectPages(async (start, size) => {
      requests++;
      return { items: Array.from({ length: size }, (_, i) => start + i), total: 100_000 };
    });
    expect(items).toHaveLength(MAX_ITEMS);
    expect(requests).toBe(3);
  });

  test('página curta com total enorme não vira centenas de requisições (teto de páginas)', async () => {
    let requests = 0;
    await collectPages(async () => {
      requests++;
      return { items: [1], total: 1_000_000_000 };
    });
    expect(requests).toBeLessThanOrEqual(5);
  });

  test('sem total, uma página mais curta que o pedido marca o fim (não fica em loop)', async () => {
    let requests = 0;
    const items = await collectPages(async () => {
      requests++;
      return { items: [1, 2, 3] };
    });
    expect(items).toEqual([1, 2, 3]);
    expect(requests).toBe(1);
  });

  test('página vazia para, mesmo se o total ainda diz que faltam itens', async () => {
    let requests = 0;
    const items = await collectPages(async () => {
      requests++;
      return { items: [], total: 900 };
    });
    expect(items).toEqual([]);
    expect(requests).toBe(1);
  });
});

describe('readCapped (miniatura grande demais)', () => {
  test('lê até o teto e devolve os bytes', async () => {
    const bytes = await readCapped(new Response(new Uint8Array([1, 2, 3])), THUMB_MAX_BYTES);
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
  });

  test('corpo que passa do teto vira null, mesmo sem content-length honesto', async () => {
    const big = new Response(new Uint8Array(THUMB_MAX_BYTES + 1));
    expect(await readCapped(big, THUMB_MAX_BYTES)).toBeNull();
  });

  test('content-length declarado acima do teto nem começa a ler', async () => {
    const res = new Response(new Uint8Array(10), { headers: { 'content-length': String(THUMB_MAX_BYTES + 1) } });
    expect(await readCapped(res, THUMB_MAX_BYTES)).toBeNull();
  });

  test('corpo vazio não é miniatura', async () => {
    expect(await readCapped(new Response(new Uint8Array(0)), THUMB_MAX_BYTES)).toBeNull();
  });
});

describe('legenda e duração', () => {
  test('episódio com série, temporada e número: "Série SxxEyy — Nome"', () => {
    expect(episodeCaption('Bleach', 1, 9, 'O Início')).toBe('Bleach S01E09 — O Início');
  });

  test('sem série ou sem número, cai para o nome do item (não inventa SxxEyy)', () => {
    expect(episodeCaption(undefined, 1, 9, 'Piloto')).toBe('Piloto');
    expect(episodeCaption('Bleach', undefined, undefined, 'Especial')).toBe('Bleach — Especial');
  });

  test('converte a unidade do servidor em segundos e trata valor ausente ou zero como desconhecido', () => {
    expect(durationSeconds(15_000_000_000, 10_000_000)).toBe(1500);
    expect(durationSeconds(1_634_794, 1000)).toBe(1635);
    expect(durationSeconds(0, 1000)).toBeNull();
    expect(durationSeconds(undefined, 1000)).toBeNull();
    expect(durationSeconds(Number.NaN, 1000)).toBeNull();
  });
});
