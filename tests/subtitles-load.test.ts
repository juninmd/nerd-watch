import { describe, expect, test } from 'bun:test';
import { isFetchableSubtitleUrl } from '../src/server/subtitles/url-guard.ts';
import { fetchSubtitleBytes, loadSubtitleAsVtt, MAX_SUBTITLE_BYTES } from '../src/server/subtitles/load.ts';
import { setHostResolver } from '../src/server/subtitles/load.ts';
// Nomes de teste resolvem para um IP público de documentação: nada sai para a rede.
setHostResolver(async () => ['203.0.113.10']);

/**
 * Busca do arquivo de legenda. O servidor baixa de terceiro, então cada teste aqui cobre uma forma de
 * o addon tentar levar o proxy para outro lugar (loopback, rede interna, redirecionamento em cadeia).
 */

interface Call {
  url: string;
  redirect: RequestRedirect | undefined;
}

/** Fetch falso: responde pela tabela de rotas e grava cada URL pedida (para provar que a rede privada nunca foi tocada). */
const fakeFetch = (routes: Record<string, () => Response>) => {
  const calls: Call[] = [];
  const fn = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, redirect: init?.redirect });
    const handler = routes[input];
    return handler ? handler() : new Response('not here', { status: 404 });
  };
  return { fn, calls };
};

const SRT_BODY = '1\n00:00:01,000 --> 00:00:02,000\nOlá, mundo\n';
const textResponse = (body: string, type = 'text/plain; charset=utf-8'): Response =>
  new Response(body, { headers: { 'content-type': type } });
const redirect = (location: string, status = 302): Response => new Response(null, { status, headers: { location } });

describe('isFetchableSubtitleUrl: host literal (SecOps)', () => {
  test.each([
    'https://subs5.strem.io/en/download/abc',
    'http://exemplo.com/a.srt',
    'https://legendas.example.com.br/x.vtt',
    'http://[2001:4860:4860::8888]/a.srt',
    'http://203.0.113.9/a.srt',
  ])('aceita público: %s', (url) => {
    expect(isFetchableSubtitleUrl(url)).toBe(true);
  });

  test.each([
    ['esquema file', 'file:///etc/passwd'],
    ['esquema ftp', 'ftp://x.example.com/a.srt'],
    ['data:', 'data:text/plain,oi'],
    ['javascript:', 'javascript:alert(1)'],
    ['loopback nome', 'http://localhost/a.srt'],
    ['loopback subdomínio', 'http://api.localhost/a.srt'],
    ['loopback 127', 'http://127.0.0.1:8080/a.srt'],
    ['loopback 127 com outro octeto', 'http://127.9.9.9/a.srt'],
    ['0.0.0.0', 'http://0.0.0.0/a.srt'],
    ['rede 10', 'http://10.0.0.5/a.srt'],
    ['rede 172.16', 'http://172.16.0.1/a.srt'],
    ['rede 172.31', 'http://172.31.255.255/a.srt'],
    ['rede 192.168', 'http://192.168.1.1/a.srt'],
    ['link-local metadados de nuvem', 'http://169.254.169.254/latest/meta-data'],
    ['CGNAT 100.64', 'http://100.64.0.1/a.srt'],
    ['IPv4 mapeado em IPv6', 'http://[::ffff:127.0.0.1]/a.srt'],
    ['IPv6 loopback', 'http://[::1]/a.srt'],
    ['IPv6 ULA fd00', 'http://[fd00::1]/a.srt'],
    ['IPv6 link-local fe80', 'http://[fe80::1]/a.srt'],
    ['IPv4 em decimal (WHATWG normaliza para 127.0.0.1)', 'http://2130706433/a.srt'],
    ['nome sem ponto (rede interna)', 'http://redis/a.srt'],
    ['nome .internal', 'http://db.internal/a.srt'],
    ['nome .local', 'http://printer.local/a.srt'],
    ['credenciais na URL', 'https://user:pass@example.com/a.srt'],
    ['localhost com ponto final (mesmo nome DNS)', 'http://localhost./a.srt'],
    ['subdomínio localhost com ponto final', 'http://api.localhost./a.srt'],
    ['6to4 embute IPv4 interno', 'http://[2002:7f00:1::]/a.srt'],
    ['Teredo embute IPv4', 'http://[2001:0:4136:e378::]/a.srt'],
    ['texto que não é URL', 'não é url'],
    ['vazio', ''],
  ])('recusa %s', (_label, url) => {
    expect(isFetchableSubtitleUrl(url)).toBe(false);
  });
});

describe('fetchSubtitleBytes: redirecionamento', () => {
  test('redirect para loopback é recusado e o loopback nunca é pedido', async () => {
    const f = fakeFetch({ 'https://subs.example.com/a.srt': () => redirect('http://127.0.0.1:7877/api/secret') });
    const got = await fetchSubtitleBytes('https://subs.example.com/a.srt', f.fn);
    expect(got).toEqual({ ok: false, reason: 'untrusted_url' });
    expect(f.calls.map((c) => c.url)).toEqual(['https://subs.example.com/a.srt']);
  });

  test('redirect é seguido à mão (redirect: manual em cada salto)', async () => {
    const f = fakeFetch({
      'https://a.example.com/x': () => redirect('https://b.example.com/y'),
      'https://b.example.com/y': () => textResponse(SRT_BODY),
    });
    const got = await fetchSubtitleBytes('https://a.example.com/x', f.fn);
    expect(got.ok).toBe(true);
    expect(f.calls.every((c) => c.redirect === 'manual')).toBe(true);
  });

  test('cadeia longa para em 3 saltos', async () => {
    const f = fakeFetch({
      'https://h.example.com/0': () => redirect('https://h.example.com/1'),
      'https://h.example.com/1': () => redirect('https://h.example.com/2'),
      'https://h.example.com/2': () => redirect('https://h.example.com/3'),
      'https://h.example.com/3': () => redirect('https://h.example.com/4'),
      'https://h.example.com/4': () => textResponse(SRT_BODY),
    });
    expect(await fetchSubtitleBytes('https://h.example.com/0', f.fn)).toEqual({
      ok: false,
      reason: 'too_many_redirects',
    });
  });

  test('redirect sem Location vira erro HTTP, não trava', async () => {
    const f = fakeFetch({ 'https://a.example.com/x': () => new Response(null, { status: 301 }) });
    expect(await fetchSubtitleBytes('https://a.example.com/x', f.fn)).toEqual({ ok: false, reason: 'http_status' });
  });

  test('Location de outro host (protocol-relative) é resolvido e ainda passa pela checagem', async () => {
    const f = fakeFetch({ 'https://a.example.com/dir/x': () => redirect('//10.0.0.1/a.srt') });
    expect(await fetchSubtitleBytes('https://a.example.com/dir/x', f.fn)).toEqual({
      ok: false,
      reason: 'untrusted_url',
    });
    expect(f.calls.map((c) => c.url)).toEqual(['https://a.example.com/dir/x']);
  });
});

describe('fetchSubtitleBytes: tipo, tamanho e status', () => {
  test('página HTML de erro não vira legenda', async () => {
    const f = fakeFetch({ 'https://a.example.com/x': () => textResponse('<html>oops</html>', 'text/html') });
    expect(await fetchSubtitleBytes('https://a.example.com/x', f.fn)).toEqual({ ok: false, reason: 'bad_type' });
  });

  test('Content-Type ausente é aceito (muitos addons não mandam)', async () => {
    const f = fakeFetch({ 'https://a.example.com/x': () => new Response(SRT_BODY) });
    expect((await fetchSubtitleBytes('https://a.example.com/x', f.fn)).ok).toBe(true);
  });

  test('arquivo acima do teto é recusado pelo Content-Length, sem ler o corpo', async () => {
    const f = fakeFetch({
      'https://a.example.com/x': () =>
        new Response('x', { headers: { 'content-length': String(MAX_SUBTITLE_BYTES + 1) } }),
    });
    expect(await fetchSubtitleBytes('https://a.example.com/x', f.fn)).toEqual({ ok: false, reason: 'too_large' });
  });

  test('arquivo sem Content-Length que passa do teto é cortado no meio da leitura', async () => {
    const chunk = new Uint8Array(MAX_SUBTITLE_BYTES / 2 + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const f = fakeFetch({
      'https://a.example.com/x': () => new Response(stream, { headers: { 'content-type': 'text/plain' } }),
    });
    expect(await fetchSubtitleBytes('https://a.example.com/x', f.fn)).toEqual({ ok: false, reason: 'too_large' });
  });

  test('status 5xx e 404 viram erro HTTP', async () => {
    for (const status of [404, 500]) {
      const f = fakeFetch({ 'https://a.example.com/x': () => new Response('nope', { status }) });
      expect(await fetchSubtitleBytes('https://a.example.com/x', f.fn)).toEqual({ ok: false, reason: 'http_status' });
    }
  });

  test('falha de rede vira unreachable', async () => {
    const fn = async () => {
      throw new TypeError('connection refused');
    };
    expect(await fetchSubtitleBytes('https://a.example.com/x', fn)).toEqual({ ok: false, reason: 'unreachable' });
  });

  test('timeout corta o download (sem esperar o servidor lento)', async () => {
    const fn = (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const started = Date.now();
    const got = await fetchSubtitleBytes('https://a.example.com/x', fn, 50);
    expect(got).toEqual({ ok: false, reason: 'unreachable' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('loadSubtitleAsVtt', () => {
  test('SRT em Windows-1252 chega como WebVTT em UTF-8', async () => {
    // "café" com é em Windows-1252 (0xE9), como sai de um editor antigo de pt-BR.
    const header = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n');
    const latin = new Uint8Array([...header, 0x63, 0x61, 0x66, 0xe9, 0x0a]);
    const f = fakeFetch({
      'https://a.example.com/x': () => new Response(latin, { headers: { 'content-type': 'application/x-subrip' } }),
    });
    const got = await loadSubtitleAsVtt('https://a.example.com/x', f.fn);
    expect(got).toEqual({ ok: true, cues: 1, vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\ncafé\n' });
  });

  test('arquivo vazio e arquivo sem cue têm motivos distintos', async () => {
    const empty = fakeFetch({ 'https://a.example.com/x': () => textResponse('   \n') });
    expect(await loadSubtitleAsVtt('https://a.example.com/x', empty.fn)).toEqual({ ok: false, reason: 'empty' });
    const noCue = fakeFetch({ 'https://a.example.com/x': () => textResponse('apenas texto solto\n') });
    expect(await loadSubtitleAsVtt('https://a.example.com/x', noCue.fn)).toEqual({ ok: false, reason: 'no_cues' });
  });

  test('o texto de erro da fonte nunca volta ao cliente (só o motivo fixo)', async () => {
    const f = fakeFetch({ 'https://a.example.com/x': () => textResponse('<script>alert(1)</script>', 'text/html') });
    const got = await loadSubtitleAsVtt('https://a.example.com/x', f.fn);
    expect(JSON.stringify(got)).not.toContain('script');
  });
});

describe('fetchSubtitleBytes: nome DNS que resolve para rede interna (DNS rebinding parcial)', () => {
  test('nome público cujo DNS aponta para loopback é recusado antes de conectar', async () => {
    setHostResolver(async () => ['127.0.0.1']);
    try {
      const f = fakeFetch({ 'https://intruso.example.com/a.srt': () => textResponse(SRT_BODY) });
      expect(await fetchSubtitleBytes('https://intruso.example.com/a.srt', f.fn)).toEqual({
        ok: false,
        reason: 'untrusted_url',
      });
      expect(f.calls).toHaveLength(0);
    } finally {
      setHostResolver(async () => ['203.0.113.10']);
    }
  });

  test('um endereço privado entre públicos já reprova o nome', async () => {
    setHostResolver(async () => ['203.0.113.10', '10.1.2.3']);
    try {
      const f = fakeFetch({ 'https://misto.example.com/a.srt': () => textResponse(SRT_BODY) });
      expect(await fetchSubtitleBytes('https://misto.example.com/a.srt', f.fn)).toEqual({
        ok: false,
        reason: 'untrusted_url',
      });
      expect(f.calls).toHaveLength(0);
    } finally {
      setHostResolver(async () => ['203.0.113.10']);
    }
  });

  test('falha de resolução vira unreachable, sem conectar', async () => {
    setHostResolver(async () => {
      throw new Error('ENOTFOUND');
    });
    try {
      const f = fakeFetch({ 'https://sumiu.example.com/a.srt': () => textResponse(SRT_BODY) });
      expect(await fetchSubtitleBytes('https://sumiu.example.com/a.srt', f.fn)).toEqual({
        ok: false,
        reason: 'unreachable',
      });
      expect(f.calls).toHaveLength(0);
    } finally {
      setHostResolver(async () => ['203.0.113.10']);
    }
  });
});
