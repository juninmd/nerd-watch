import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { registerDescriptor, registerSource, restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import { relayMedia, syntheticMessageId, titleFromFilename } from '../src/server/providers/sources/service.ts';
import { type FileSource, SourceError } from '../src/server/providers/sources/types.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';

const snapshot = snapshotRegistry();
let videos: Array<{ name: string; date: string }> = [];
let failList = false;

/** Fonte falsa no modo 'plex': só o contrato do `FileSource`, sem rede. */
const fakeSource: FileSource = {
  mode: 'plex',
  link: () => null,
  async resolve(input) {
    if (!input.startsWith('ok:')) throw new SourceError('entrada inválida', 400);
    return { handle: `plex:${input.slice(3)}`, name: `Biblioteca ${input.slice(3)}` };
  },
  async list() {
    if (failList) throw new SourceError('a origem caiu', 502);
    return videos.map((v, i) => ({ messageId: syntheticMessageId(v.date, `f${i}`), caption: titleFromFilename(v.name), postedAt: v.date, fileRef: `ref-${i}` }));
  },
  async play({ fileRef, range }) {
    return new Response(`${fileRef}:${range ?? 'full'}`, { headers: { 'Content-Type': 'video/mp4' } });
  },
};

beforeAll(() => {
  registerSource(fakeSource);
  registerDescriptor({
    id: 'plex',
    title: 'Plex falso',
    description: 'teste',
    icon: 'folder',
    fields: [
      { key: 'url', label: 'endereço', env: 'TEST_SRC_URL', validate: (v) => (v.startsWith('http') ? null : 'precisa começar com http') },
      { key: 'token', label: 'token', env: 'TEST_SRC_TOKEN', secret: true },
      { key: 'roots', label: 'raízes', env: 'TEST_SRC_ROOTS', readOnly: true },
    ],
    add: { mode: 'plex', label: 'biblioteca', placeholder: 'ok:nome' },
    configured: () => Boolean(process.env.TEST_SRC_URL),
    connected: () => Boolean(process.env.TEST_SRC_URL),
  });
});

afterAll(() => restoreRegistry(snapshot));

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  videos = [
    { name: 'Ep 08.mp4', date: '2026-09-12T12:00:00.000Z' },
    { name: 'Ep 09.mp4', date: '2026-10-19T12:00:00.000Z' },
  ];
  failList = false;
});

afterEach(() => {
  delete process.env.TEST_SRC_URL;
  delete process.env.TEST_SRC_TOKEN;
});

const post = (path: string, body: unknown) => sourcesRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/sources e POST …/settings', () => {
  test('lista a fonte e nunca devolve o valor de um segredo, só se está preenchido', async () => {
    process.env.TEST_SRC_TOKEN = 'token-super-secreto';
    process.env.TEST_SRC_URL = 'http://nas.local:8096';
    const text = await (await sourcesRoutes.request('/')).text();
    expect(text).not.toContain('token-super-secreto');
    const source = (JSON.parse(text) as { sources: Array<{ id: string; fields: Array<{ key: string; set: boolean; value: string }> }> }).sources.find((s) => s.id === 'plex');
    expect(source?.fields.find((f) => f.key === 'token')).toMatchObject({ set: true, value: '' });
    expect(source?.fields.find((f) => f.key === 'url')).toMatchObject({ set: true, value: 'http://nas.local:8096' });
  });

  test('grava os campos válidos, aceita limpar com string vazia e usa o validador do campo', async () => {
    expect((await post('/plex/settings', { values: { url: 'ftp://x' } })).status).toBe(400);
    expect(process.env.TEST_SRC_URL).toBeUndefined();

    const ok = await post('/plex/settings', { values: { url: 'http://nas.local:8096', token: 'abc' } });
    expect(ok.status).toBe(200);
    expect(process.env.TEST_SRC_URL).toBe('http://nas.local:8096');
    expect(process.env.TEST_SRC_TOKEN).toBe('abc');

    await post('/plex/settings', { values: { token: '' } });
    expect(process.env.TEST_SRC_TOKEN).toBeUndefined();
  });

  test('campo somente-leitura (lista de permissão do disco) não muda pela API e o DTO avisa a UI', async () => {
    process.env.TEST_SRC_ROOTS = '/videos';
    const res = await post('/plex/settings', { values: { roots: '/' } });
    expect(res.status).toBe(403);
    expect(process.env.TEST_SRC_ROOTS).toBe('/videos');
    const dto = (await (await sourcesRoutes.request('/')).json()) as { sources: Array<{ id: string; fields: Array<{ key: string; readOnly: boolean }> }> };
    expect(dto.sources.find((s) => s.id === 'plex')?.fields.find((f) => f.key === 'roots')?.readOnly).toBe(true);
    delete process.env.TEST_SRC_ROOTS;
  });

  test('um campo inválido não deixa gravar os outros (tudo ou nada) e rejeita chave desconhecida e quebra de linha', async () => {
    expect((await post('/plex/settings', { values: { token: 'abc', url: 'ftp://x' } })).status).toBe(400);
    expect(process.env.TEST_SRC_TOKEN).toBeUndefined();
    expect((await post('/plex/settings', { values: { inexistente: 'x' } })).status).toBe(400);
    expect((await post('/plex/settings', { values: { token: 'a\nINJETADO=1' } })).status).toBe(400);
    expect((await post('/nao-existe/settings', { values: {} })).status).toBe(404);
  });
});

describe('POST /api/sources/:mode/channels', () => {
  test('cria o canal da fonte e importa os vídeos do mais novo ao mais antigo', async () => {
    const res = await post('/plex/channels', { input: 'ok:Anime' });
    expect(res.status).toBe(201);
    const channel = (await res.json()) as { titleId: string; mode: string; title: string; itemCount: number; link: string | null };
    expect(channel).toMatchObject({ mode: 'plex', title: 'Biblioteca Anime', itemCount: 2, link: null });
    const detail = (await (await telegramRoutes.request(`/channels/${channel.titleId}`)).json()) as { items: Array<{ caption: string }> };
    expect(detail.items.map((i) => i.caption)).toEqual(['Ep 09', 'Ep 08']);
  });

  test('entrada inválida volta o status do SourceError e não cria nada', async () => {
    expect((await post('/plex/channels', { input: 'lixo' })).status).toBe(400);
    expect((await post('/plex/channels', {})).status).toBe(400);
    expect((await post('/inexistente/channels', { input: 'x' })).status).toBe(404);
    expect(((await (await telegramRoutes.request('/channels')).json()) as { channels: unknown[] }).channels).toHaveLength(0);
  });

  test('se a primeira leitura falha o canal recém-criado é desfeito, mas um canal que já existia é mantido', async () => {
    failList = true;
    const res = await post('/plex/channels', { input: 'ok:Novo' });
    expect(res.status).toBe(502);
    expect(((await (await telegramRoutes.request('/channels')).json()) as { channels: unknown[] }).channels).toHaveLength(0);

    failList = false;
    await post('/plex/channels', { input: 'ok:Novo' });
    failList = true;
    expect((await post('/plex/channels', { input: 'ok:Novo' })).status).toBe(502);
    expect(((await (await telegramRoutes.request('/channels')).json()) as { channels: unknown[] }).channels).toHaveLength(1);
  });

  test('atualizar e tocar passam pela fonte genérica (Range repassado, ref nunca exposta)', async () => {
    const { titleId } = (await (await post('/plex/channels', { input: 'ok:Anime' })).json()) as { titleId: string };
    videos.push({ name: 'Ep 10.mp4', date: '2026-10-26T12:00:00.000Z' });
    const refreshed = await telegramRoutes.request(`/channels/${titleId}/refresh`, { method: 'POST' });
    expect(await refreshed.json()).toEqual({ itemCount: 3 });

    const detailText = await (await telegramRoutes.request(`/channels/${titleId}`)).text();
    expect(detailText).not.toContain('ref-');
    const messageId = (JSON.parse(detailText) as { items: Array<{ messageId: string }> }).items[0]?.messageId;
    const play = await telegramRoutes.request(`/channels/${titleId}/items/${messageId}/play`, { headers: { Range: 'bytes=0-9' } });
    expect(await play.text()).toBe('ref-2:bytes=0-9');
    expect((await telegramRoutes.request(`/channels/${titleId}/items/1/play`)).status).toBe(404);
  });
});

describe('utilitários', () => {
  test('messageId sintético é estável, cresce com a data e distingue arquivos do mesmo instante', () => {
    const a = syntheticMessageId('2026-10-19T12:00:00.000Z', 'arquivo-a');
    expect(syntheticMessageId('2026-10-19T12:00:00.000Z', 'arquivo-a')).toBe(a);
    expect(syntheticMessageId('2026-10-19T12:00:00.000Z', 'arquivo-b')).not.toBe(a);
    expect(BigInt(syntheticMessageId('2026-10-26T12:00:00.000Z', 'arquivo-a'))).toBeGreaterThan(BigInt(a));
    expect(syntheticMessageId(null, 'x')).toMatch(/^\d+$/);
  });

  test('titleFromFilename tira só a extensão', () => {
    expect(titleFromFilename('Bleach - 09.mkv')).toBe('Bleach - 09');
    expect(titleFromFilename('semextensao')).toBe('semextensao');
  });

  test('relayMedia repassa mídia e Range, traduz 404 e esconde o corpo de erros da origem', async () => {
    const partial = relayMedia(new Response('xyz', { status: 206, headers: { 'Content-Range': 'bytes 5-7/100', 'Content-Type': 'video/mp4', 'X-Secret': 'nao-repassa' } }), 'nada');
    expect(partial.status).toBe(206);
    expect(partial.headers.get('Content-Range')).toBe('bytes 5-7/100');
    expect(partial.headers.get('Accept-Ranges')).toBe('bytes');
    expect(partial.headers.get('X-Secret')).toBeNull();

    expect(relayMedia(new Response('', { status: 404 }), 'não achei').status).toBe(404);
    const broken = relayMedia(new Response('stack trace interno', { status: 500 }), 'x');
    expect(broken.status).toBe(502);
    expect(await broken.text()).not.toContain('stack trace');
  });
});
