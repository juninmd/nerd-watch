import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { parseLocation, setS3FetchForTests } from '../src/server/providers/s3/api.ts';
import { s3Source, registerS3 } from '../src/server/providers/s3/source.ts';
import { validateS3AccessKey, validateS3Endpoint, validateS3Region, validateS3SecretKey } from '../src/server/providers/s3/config.ts';
import { snapshotRegistry, restoreRegistry } from '../src/server/providers/sources/registry.ts';
import type { SourceError } from '../src/server/providers/sources/types.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';

const ENDPOINT = 'https://s3.test';
const ACCESS_KEY = 'AKIATESTKEY0001';
const SECRET = 'segredo-de-teste-9876';

let calls: Array<{ method: string; url: URL; auth: string | null; range: string | null; amzDate: string | null }> = [];
let mode: 'normal' | 'forbidden' | 'nobucket' | 'malformed' | 'redirect' | 'endless' = 'normal';

const page = (contents: string, next: string | null): string =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
  `<IsTruncated>${next ? 'true' : 'false'}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''}${contents}</ListBucketResult>`;

const obj = (key: string, lastModified: string): string => `<Contents><Key>${key}</Key><LastModified>${lastModified}</LastModified><Size>10</Size></Contents>`;

const fake = async (input: string | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  calls.push({ method: String(init?.method), url, auth: headers.get('authorization'), range: headers.get('range'), amzDate: headers.get('x-amz-date') });
  if (mode === 'forbidden') return new Response(`<Error>${SECRET}</Error>`, { status: 403 });
  if (mode === 'nobucket') return new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 });
  if (mode === 'malformed') return new Response('<ListBucketResult><Contents>', { status: 200 });
  if (mode === 'redirect') return new Response('', { status: 301, headers: { Location: 'https://evil.test/' } });
  if (mode === 'endless') return new Response(page(obj('anime/Ep.mp4', '2026-10-01T00:00:00.000Z'), 'sempre-mais'), { status: 200 });

  if (url.searchParams.get('list-type') === '2') {
    if (url.searchParams.get('continuation-token') === 'tok-2') {
      return new Response(
        page(
          obj('anime/Ep 04.webm', '2026-10-04T00:00:00.000Z') +
            obj('anime/../evil.mp4', '2026-10-09T00:00:00.000Z') +
            obj('outro/fora.mp4', '2026-10-09T00:00:00.000Z') +
            obj('anime/pasta/', '2026-10-09T00:00:00.000Z'),
          null,
        ),
        { status: 200 },
      );
    }
    return new Response(
      page(
        obj('anime/Ep 01.mp4', '2026-10-01T00:00:00.000Z') +
          obj('anime/notas.txt', '2026-10-02T00:00:00.000Z') +
          obj('anime/Ep 02 &amp; 03.mkv', '2026-10-03T00:00:00.000Z'),
        'tok-2',
      ),
      { status: 200 },
    );
  }

  if (url.pathname.endsWith('/anime/Ep%2001.mp4')) {
    if (headers.get('range') === 'bytes=0-9') {
      return new Response('ABCDEFGHIJ', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-9/50', 'Content-Length': '10' } });
    }
    return new Response('VIDEO', { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '5' } });
  }
  return new Response('', { status: 404 });
};

beforeEach(() => {
  process.env.S3_ENDPOINT = ENDPOINT;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY = ACCESS_KEY;
  process.env.S3_SECRET_KEY = SECRET;
  calls = [];
  mode = 'normal';
  setS3FetchForTests(fake);
});

afterEach(() => {
  setS3FetchForTests(null);
  for (const k of ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) delete process.env[k];
});

describe('localização (bucket e prefixo)', () => {
  test('aceita bucket, bucket/prefixo e bucket/prefixo/; recusa nomes e caminhos hostis', () => {
    expect(parseLocation('media')).toEqual({ bucket: 'media', prefix: '' });
    expect(parseLocation('media/anime')).toEqual({ bucket: 'media', prefix: 'anime/' });
    expect(parseLocation('media/anime/')).toEqual({ bucket: 'media', prefix: 'anime/' });
    expect(parseLocation('Media')).toBeNull();
    expect(parseLocation('ab')).toBeNull(); // regra do S3: 3 a 63 caracteres
    expect(parseLocation('media/../x')).toBeNull();
    expect(parseLocation('media/a\u0001b')).toBeNull();
    expect(parseLocation('media//x')).toBeNull();
  });
});

describe('resolve e list (ListObjectsV2)', () => {
  test('resolve assina a requisição e devolve o handle com o prefixo', async () => {
    const res = await s3Source.resolve('media/anime/');
    expect(res).toEqual({ handle: 's3:media/anime/', name: 'anime' });
    const first = calls[0];
    expect(first?.url.pathname).toBe('/media/');
    expect(first?.url.searchParams.get('prefix')).toBe('anime/');
    expect(first?.auth?.startsWith(`AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/`)).toBe(true);
    expect(first?.amzDate).toMatch(/^\d{8}T\d{6}Z$/);
  });

  test('segue a paginação, decodifica entidades, descarta chaves inseguras e fora do prefixo, e ordena do mais novo', async () => {
    const items = await s3Source.list('s3:media/anime/');
    expect(calls.map((c) => c.url.searchParams.get('continuation-token'))).toEqual([null, 'tok-2']);
    expect(items.map((i) => i.fileRef)).toEqual(['anime/Ep 04.webm', 'anime/Ep 02 & 03.mkv', 'anime/Ep 01.mp4']);
    expect(items.map((i) => i.caption)).toEqual(['Ep 04', 'Ep 02 & 03', 'Ep 01']);
  });

  test('paginação tem teto: um bucket que nunca acaba para em 20 páginas', async () => {
    mode = 'endless';
    await s3Source.list('s3:media/anime/');
    expect(calls).toHaveLength(20);
  });

  test('bucket inexistente é 404 nosso; XML malformado é 502 nosso', async () => {
    mode = 'nobucket';
    expect(((await s3Source.resolve('nope').catch((e) => e)) as SourceError).status).toBe(404);
    mode = 'malformed';
    expect(((await s3Source.list('s3:media/').catch((e) => e)) as SourceError).message).toBe('resposta do S3 inválida');
  });

  test('redirect é 502 e não é seguido', async () => {
    mode = 'redirect';
    const err = (await s3Source.list('s3:media/').catch((e) => e)) as SourceError;
    expect(err.status).toBe(502);
    expect(calls.some((c) => c.url.host === 'evil.test')).toBe(false);
  });

  test('credencial recusada é 409 sem ecoar o corpo (que aqui traz o segredo) nem o segredo', async () => {
    mode = 'forbidden';
    const err = (await s3Source.list('s3:media/').catch((e) => e)) as SourceError;
    expect(err.status).toBe(409);
    expect(err.message).not.toContain(SECRET);
  });

  test('endpoint com prefixo de caminho (MinIO atrás de proxy) mantém o caminho no path-style', async () => {
    process.env.S3_ENDPOINT = 'https://proxy.test/minio/';
    await s3Source.list('s3:media/');
    expect(calls[0]?.url.pathname).toBe('/minio/media/');
  });

  test('a região vai no escopo da assinatura (Cloudflare R2 usa "auto")', async () => {
    process.env.S3_REGION = 'auto';
    await s3Source.list('s3:media/');
    expect(calls[0]?.auth).toContain('/auto/s3/aws4_request');
  });

  test('sem configuração a fonte diz o que falta e não faz requisição', async () => {
    delete process.env.S3_SECRET_KEY;
    const err = (await s3Source.list('s3:media/').catch((e) => e)) as SourceError;
    expect(err.status).toBe(501);
    expect(calls).toHaveLength(0);
  });
});

describe('play (GET assinado com Range)', () => {
  test('repassa o Range assinado, devolve 206 e não expõe cabeçalhos de autenticação', async () => {
    const res = await s3Source.play({ handle: 's3:media/anime/', fileRef: 'anime/Ep 01.mp4', range: 'bytes=0-9' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-9/50');
    expect(res.headers.get('Authorization')).toBeNull();
    expect(await res.text()).toBe('ABCDEFGHIJ');
    const sent = calls.at(-1);
    expect(sent?.range).toBe('bytes=0-9');
    expect(sent?.auth).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
  });

  test('fileRef fora do prefixo, com .. ou que não é vídeo é 404 antes da rede', async () => {
    for (const fileRef of ['outro/x.mp4', 'anime/../x.mp4', 'anime/notas.txt']) {
      const err = (await s3Source.play({ handle: 's3:media/anime/', fileRef, range: undefined }).catch((e) => e)) as SourceError;
      expect(err.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('validação dos campos', () => {
  test('endpoint com credencial embutida ou com query é recusado', () => {
    expect(validateS3Endpoint('https://chave:segredo@s3.test')).not.toBeNull();
    expect(validateS3Endpoint('https://s3.test/?x=1')).not.toBeNull();
    expect(validateS3Endpoint('http://minio.local:9000')).toBeNull();
  });

  test('região, chave e segredo têm formato restrito (sem espaços nem controle)', () => {
    expect(validateS3Region('us-east-1')).toBeNull();
    expect(validateS3Region('auto')).toBeNull();
    expect(validateS3Region('US East')).not.toBeNull();
    expect(validateS3AccessKey('ABC DEF')).not.toBeNull();
    expect(validateS3AccessKey('AKIA0000000000000001')).toBeNull();
    expect(validateS3SecretKey('curto')).not.toBeNull();
    expect(validateS3SecretKey('segredo-com-tamanho-ok')).toBeNull();
  });
});

describe('segredo nunca sai pela API de fontes', () => {
  const snapshot = snapshotRegistry();
  beforeAll(() => registerS3());
  afterAll(() => restoreRegistry(snapshot));

  test('GET /api/sources mostra o S3 sem o valor do segredo (só set: true)', async () => {
    const text = await (await sourcesRoutes.request('/')).text();
    expect(text).toContain('"id":"s3"');
    expect(text).not.toContain(SECRET);
    const s3 = (JSON.parse(text) as { sources: Array<{ id: string; fields: Array<{ key: string; set: boolean; value: string }> }> }).sources.find((s) => s.id === 's3');
    expect(s3?.fields.find((f) => f.key === 'secretKey')).toMatchObject({ set: true, value: '' });
  });
});
