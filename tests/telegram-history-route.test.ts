import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/server/config.ts';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { PrivateChannelNotFoundError } from '../src/server/providers/telegram/peer.ts';
import * as personal from '../src/server/providers/telegram/personal.ts';
import * as personalInfo from '../src/server/providers/telegram/personal-info.ts';
import { getTelegramChannel, listTelegramItems, updateChannelCursor, upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';
import { resetThumbRetries } from '../src/server/telegram-item-thumbs.ts';
import { historyLimits } from '../src/server/telegram-history.ts';
import { photoStore } from '../src/server/telegram-photos.ts';
import type { TelegramChannelMode } from '../src/server/types.ts';

const FIXTURE = readFileSync(`${import.meta.dir}/fixtures/telegram-public-channel.html`, 'utf-8');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const originalTelegramConfig = { ...config.telegram };
const originalFetch = globalThis.fetch;
const originalDir = photoStore.dir;
let dir: string;
const spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetThumbRetries();
  dir = mkdtempSync(join(tmpdir(), 'nw-history-'));
  photoStore.dir = () => dir;
  Object.assign(config.telegram, { botToken: undefined, apiId: 1, apiHash: 'x'.repeat(32), session: 'fake' });
  spies.push(spyOn(personalInfo, 'fetchPersonalChannelInfo').mockResolvedValue({ title: null, description: null, photo: null }));
  spies.push(spyOn(personalInfo, 'fetchPersonalThumbs').mockImplementation(async (_h, ids) => new Map(ids.map((id) => [id, PNG]))));
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  globalThis.fetch = originalFetch;
  photoStore.dir = originalDir;
  Object.assign(config.telegram, originalTelegramConfig);
  rmSync(dir, { recursive: true, force: true });
});

const item = (id: number, text = `v${id}`) => ({ messageId: String(id), caption: text, durationSeconds: 60, postedAt: '2026-10-01T00:00:00.000Z' });
/** Ids em ordem decrescente de `from` até `to`, como o Telegram devolve. */
const ids = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

const setup = (mode: TelegramChannelMode, handle: string, stored: number[], cursor: string | null) => {
  const db = openDb(':memory:');
  resetDbForTests(db);
  const channel = upsertTelegramChannel(db, { handle, mode });
  upsertTelegramItems(
    db,
    channel.id,
    stored.map((id) => item(id)),
  );
  if (cursor) updateChannelCursor(db, channel.id, cursor);
  return { db, channel };
};

const post = (id: string, action: 'load-more' | 'search', body?: unknown) =>
  telegramRoutes.request(`/channels/${id}/${action}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/** Substitui a busca de página do Telegram; devolve o espião para conferir os argumentos. */
const fakePage = (messageIds: number[], opts: { exhausted?: boolean } = {}) => {
  const spy = spyOn(personal, 'fetchPersonalVideoPage').mockResolvedValue({
    items: messageIds.map((id) => item(id)),
    exhausted: opts.exhausted ?? false,
    oldestId: messageIds.length ? String(Math.min(...messageIds)) : null,
  });
  spies.push(spy);
  return spy;
};

describe('POST /channels/:id/load-more — conta pessoal', () => {
  test('continua de onde o cursor parou, grava os vídeos mais antigos e avança o cursor', async () => {
    const { db, channel } = setup('personal', 'c/2675951342', ids(130, 101), '101');
    const page = fakePage(ids(100, 71));
    const res = await post(channel.id, 'load-more');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 30, total: 60, exhausted: false });
    expect(page.mock.calls[0]).toEqual(['c/2675951342', { before: '101' }]);
    expect(listTelegramItems(db, channel.id)).toHaveLength(60);
    expect(getTelegramChannel(db, channel.id)?.cursor).toBe('71');
  });

  test('os vídeos novos já chegam com miniatura local', async () => {
    const { db, channel } = setup('personal', 'c/2675951342', [200], '200');
    fakePage([199, 198]);
    await post(channel.id, 'load-more');
    const fresh = listTelegramItems(db, channel.id).filter((i) => ['199', '198'].includes(i.message_id));
    expect(fresh).toHaveLength(2);
    expect(fresh.every((i) => i.thumbnail_url?.startsWith('/api/telegram/channels/'))).toBe(true);
  });

  test('sem cursor (canal antigo) começa do topo: reler a página mais nova é inofensivo, pular o meio não', async () => {
    const { channel } = setup('personal', 'cine_ch', [50, 40, 30], null);
    const page = fakePage([50, 40, 30]);
    await post(channel.id, 'load-more');
    expect(page.mock.calls[0]?.[1]).toEqual({});
  });

  test('buscar num canal sem cursor não abre lacuna: o load-more seguinte ainda parte do topo', async () => {
    const { channel } = setup('personal', 'cine_ch', [200, 199], null);
    const page = fakePage([5]);
    await post(channel.id, 'search', { q: 'antigo' });
    page.mockResolvedValue({ items: [item(198)], exhausted: false, oldestId: '198' });
    await post(channel.id, 'load-more');
    expect(page.mock.calls[1]?.[1]).toEqual({});
  });

  test('só as miniaturas dos vídeos da página nova são pedidas, não as de todo o canal', async () => {
    const { channel } = setup('personal', 'cine_ch', [12, 11, 10], '10');
    fakePage([9]);
    const thumbs = personalInfo.fetchPersonalThumbs as unknown as { mock: { calls: unknown[][] } };
    thumbs.mock.calls.length = 0;
    await post(channel.id, 'load-more');
    expect(thumbs.mock.calls.map((c) => c[1])).toEqual([['9']]);
  });

  test('uma chamada que trava não deixa o canal bloqueado: estoura o tempo (502) e libera o próximo clique', async () => {
    const { channel } = setup('personal', 'cine_ch', [10], '10');
    const page = fakePage([9]);
    page.mockImplementationOnce(() => new Promise(() => {}));
    const before = historyLimits.workMs;
    historyLimits.workMs = 20;
    try {
      expect((await post(channel.id, 'load-more')).status).toBe(502);
      expect((await post(channel.id, 'load-more')).status).toBe(200);
    } finally {
      historyLimits.workMs = before;
    }
  });

  test('página curta marca o fim do histórico e a chamada seguinte nem pergunta ao Telegram', async () => {
    const { db, channel } = setup('personal', 'cine_ch', [10], '10');
    const page = fakePage([9, 8], { exhausted: true });
    expect(await (await post(channel.id, 'load-more')).json()).toEqual({ added: 2, total: 3, exhausted: true });
    expect(getTelegramChannel(db, channel.id)?.cursor).toBe('end');
    expect(await (await post(channel.id, 'load-more')).json()).toEqual({ added: 0, total: 3, exhausted: true });
    expect(page).toHaveBeenCalledTimes(1);
  });

  test('página que não anda para trás (mesmo id) também encerra, em vez de repetir para sempre', async () => {
    const { db, channel } = setup('personal', 'cine_ch', [10], '10');
    fakePage([10]);
    expect(await (await post(channel.id, 'load-more')).json()).toMatchObject({ exhausted: true });
    expect(getTelegramChannel(db, channel.id)?.cursor).toBe('end');
  });

  test('o detalhe do canal diz se ainda dá para carregar mais', async () => {
    const { channel } = setup('personal', 'cine_ch', [10], '10');
    const open = async () => (await (await telegramRoutes.request(`/channels/${channel.id}`)).json()) as { canLoadMore: boolean };
    expect((await open()).canLoadMore).toBe(true);
    fakePage([], { exhausted: true });
    await post(channel.id, 'load-more');
    expect((await open()).canLoadMore).toBe(false);
  });

  test('canal inexistente: 404; modo bot: 501 com o motivo', async () => {
    expect((await post('123e4567-e89b-42d3-a456-426614174000', 'load-more')).status).toBe(404);
    const { channel } = setup('bot', 'canalbot', [1], null);
    const res = await post(channel.id, 'load-more');
    expect(res.status).toBe(501);
    expect(((await res.json()) as { error: string }).error).toContain('bot');
  });

  test('sem sessão pessoal: 501 e nada é pedido ao Telegram', async () => {
    const { channel } = setup('personal', 'cine_ch', [10], '10');
    const page = fakePage([9]);
    Object.assign(config.telegram, { session: undefined });
    expect((await post(channel.id, 'load-more')).status).toBe(501);
    expect(page).not.toHaveBeenCalled();
  });

  test('conta que saiu do canal privado: 404 com a mensagem certa; falha qualquer: 502 e o cursor não mexe', async () => {
    const { db, channel } = setup('personal', 'c/2675951342', [10], '10');
    const page = fakePage([9]);
    page.mockRejectedValueOnce(new PrivateChannelNotFoundError());
    const gone = await post(channel.id, 'load-more');
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { error: string }).error).toContain('não participa');
    page.mockRejectedValueOnce(new Error('rede'));
    expect((await post(channel.id, 'load-more')).status).toBe(502);
    expect(getTelegramChannel(db, channel.id)?.cursor).toBe('10');
  });

  test('duas chamadas ao mesmo tempo no mesmo canal: a segunda leva 409 em vez de duplicar o trabalho', async () => {
    const { channel } = setup('personal', 'cine_ch', [10], '10');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = fakePage([9]);
    page.mockImplementation(async () => {
      await gate;
      return { items: [item(9)], exhausted: false, oldestId: '9' };
    });
    const first = post(channel.id, 'load-more');
    const second = await post(channel.id, 'load-more');
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect((await post(channel.id, 'load-more')).status).toBe(200);
  });
});

describe('POST /channels/:id/search', () => {
  test('busca o texto no Telegram inteiro, guarda os achados e não mexe no cursor', async () => {
    const { db, channel } = setup('personal', 'c/2675951342', [100, 99], '99');
    const page = fakePage([40, 12]);
    const res = await post(channel.id, 'search', { q: '  Enrolados  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: 2, added: 2, total: 4 });
    expect(page.mock.calls[0]).toEqual(['c/2675951342', { query: 'Enrolados' }]);
    expect(getTelegramChannel(db, channel.id)?.cursor).toBe('99');
    expect(
      listTelegramItems(db, channel.id)
        .map((i) => i.message_id)
        .sort(),
    ).toEqual(['100', '12', '40', '99']);
  });

  test('o que já estava na lista não conta como novo', async () => {
    const { channel } = setup('personal', 'cine_ch', [100, 99], null);
    fakePage([100, 5]);
    expect(await (await post(channel.id, 'search', { q: 'x' })).json()).toEqual({ found: 2, added: 1, total: 3 });
  });

  test('texto vazio, só espaços, ausente, não-string ou longo demais: 400', async () => {
    const { channel } = setup('personal', 'cine_ch', [1], null);
    const page = fakePage([2]);
    for (const body of [undefined, {}, { q: '' }, { q: '   ' }, { q: 42 }, { q: 'x'.repeat(101) }]) {
      expect((await post(channel.id, 'search', body)).status).toBe(400);
    }
    expect(page).not.toHaveBeenCalled();
  });

  test('canal público que deixou de existir: 404, como na importação', async () => {
    globalThis.fetch = (async () => new Response('<html>nada</html>')) as unknown as typeof fetch;
    const { channel } = setup('public', 'canalteste', [101], '101');
    expect((await post(channel.id, 'search', { q: 'x' })).status).toBe(404);
  });

  test('canal inexistente: 404; modo bot: 501', async () => {
    expect((await post('123e4567-e89b-42d3-a456-426614174000', 'search', { q: 'x' })).status).toBe(404);
    const { channel } = setup('bot', 'canalbot', [1], null);
    expect((await post(channel.id, 'search', { q: 'x' })).status).toBe(501);
  });
});

describe('canal público (prévia t.me/s)', () => {
  const captureFetch = (html = FIXTURE) => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: URL | string) => {
      urls.push(String(url));
      return new Response(html);
    }) as unknown as typeof fetch;
    return urls;
  };

  test('load-more pede `before` com o cursor e avança para o post mais antigo da página', async () => {
    const urls = captureFetch();
    const { db, channel } = setup('public', 'canalteste', [101], '101');
    const res = await post(channel.id, 'load-more');
    expect(res.status).toBe(200);
    expect(new URL(urls[0] as string).searchParams.get('before')).toBe('101');
    expect(getTelegramChannel(db, channel.id)?.cursor).toBe('100');
  });

  test('chegar ao primeiro post do canal encerra o histórico', async () => {
    captureFetch('<div class="tgme_channel_info"></div><div class="tgme_widget_message " data-post="canalteste/1"></div>');
    const { db, channel } = setup('public', 'canalteste', [5], '5');
    expect(await (await post(channel.id, 'load-more')).json()).toMatchObject({ exhausted: true });
    expect(getTelegramChannel(db, channel.id)?.cursor).toBe('end');
  });

  test('search manda o texto como ?q=', async () => {
    const urls = captureFetch();
    const { channel } = setup('public', 'canalteste', [101], '101');
    await post(channel.id, 'search', { q: 'dois nomes' });
    expect(new URL(urls[0] as string).searchParams.get('q')).toBe('dois nomes');
  });
});

describe('importar já deixa o cursor pronto para carregar mais', () => {
  const importPersonal = async (handle: string) =>
    (await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle, mode: 'personal' }) })).json()) as { canLoadMore: boolean };

  test('personal: página cheia deixa carregar mais; página curta já é o fim', async () => {
    resetDbForTests(openDb(':memory:'));
    const page = fakePage([20, 19]);
    expect((await importPersonal('c/111111')).canLoadMore).toBe(true);
    page.mockResolvedValue({ items: [item(3)], exhausted: true, oldestId: '3' });
    expect((await importPersonal('c/222222')).canLoadMore).toBe(false);
  });
});
