import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Api } from 'teleproto';
import * as personal from '../src/server/providers/telegram/personal.ts';
import { fetchPersonalChannelItems, fetchPersonalVideoPage, PERSONAL_PAGE_SIZE } from '../src/server/providers/telegram/personal.ts';

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

const video = (id: number, text = `v${id}`) =>
  Object.assign(Object.create(Api.Message.prototype), {
    id,
    message: text,
    date: 1_790_000_000 + id,
    media: Object.assign(Object.create(Api.MessageMediaDocument.prototype), {
      document: Object.assign(Object.create(Api.Document.prototype), { mimeType: 'video/mp4', attributes: [], thumbs: [] }),
    }),
  });
const photo = (id: number) => Object.assign(Object.create(Api.Message.prototype), { id, message: 'foto', date: 1_790_000_000, media: undefined });

/** Cliente falso que devolve as mensagens dadas e guarda os argumentos do `getMessages`. */
const fakeClient = (messages: unknown[]) => {
  const calls: Array<{ peer: unknown; opts: Record<string, unknown> }> = [];
  const client = {
    getMessages: async (peer: unknown, opts: Record<string, unknown>) => {
      calls.push({ peer, opts });
      return messages;
    },
  };
  spies.push(spyOn(personal, 'withLiveSession').mockImplementation(async (fn) => fn(client as never)));
  return calls;
};

describe('fetchPersonalVideoPage', () => {
  test('pede uma página cheia de vídeos, do mais novo ao mais antigo', async () => {
    const calls = fakeClient([video(30), video(29)]);
    await fetchPersonalVideoPage('cine_ch');
    expect(calls[0]?.peer).toBe('cine_ch');
    expect(calls[0]?.opts).toMatchObject({ limit: PERSONAL_PAGE_SIZE, offsetId: 0 });
    expect(calls[0]?.opts.filter).toBeInstanceOf(Api.InputMessagesFilterVideo);
    expect(calls[0]?.opts).not.toHaveProperty('search');
  });

  test('`before` vira o offsetId: só vêm mensagens mais antigas que ele', async () => {
    const calls = fakeClient([video(9)]);
    await fetchPersonalVideoPage('cine_ch', { before: '10' });
    expect(calls[0]?.opts.offsetId).toBe(10);
  });

  test('`query` vira busca de texto no Telegram, mantendo o filtro de vídeo', async () => {
    const calls = fakeClient([video(5, 'Enrolados')]);
    await fetchPersonalVideoPage('cine_ch', { query: 'enrolados' });
    expect(calls[0]?.opts).toMatchObject({ search: 'enrolados' });
    expect(calls[0]?.opts.filter).toBeInstanceOf(Api.InputMessagesFilterVideo);
  });

  test('página cheia: ainda há histórico; página curta: acabou', async () => {
    const full = Array.from({ length: PERSONAL_PAGE_SIZE }, (_, i) => video(PERSONAL_PAGE_SIZE - i));
    fakeClient(full);
    expect(await fetchPersonalVideoPage('cine_ch')).toMatchObject({ exhausted: false, oldestId: '1' });
    for (const spy of spies.splice(0)) spy.mockRestore();
    fakeClient([video(7), video(6)]);
    expect(await fetchPersonalVideoPage('cine_ch')).toMatchObject({ exhausted: true, oldestId: '6' });
  });

  test('mensagem que não é vídeo conta para o fim do histórico, mas não vira item', async () => {
    fakeClient([video(8), photo(7)]);
    const page = await fetchPersonalVideoPage('cine_ch');
    expect(page.items.map((i) => i.messageId)).toEqual(['8']);
    expect(page.oldestId).toBe('7');
  });

  test('página vazia: acabou e não há id mais antigo', async () => {
    fakeClient([]);
    expect(await fetchPersonalVideoPage('cine_ch')).toEqual({ items: [], exhausted: true, oldestId: null });
  });

  test('fetchPersonalChannelItems segue devolvendo só a lista', async () => {
    fakeClient([video(3, 'Legenda')]);
    expect(await fetchPersonalChannelItems('cine_ch')).toEqual([
      { messageId: '3', caption: 'Legenda', durationSeconds: null, postedAt: new Date((1_790_000_000 + 3) * 1000).toISOString() },
    ]);
  });
});
