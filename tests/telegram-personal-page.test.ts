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
const fakeClient = (messages: unknown[], probe: unknown[] = []) => {
  const calls: Array<{ peer: unknown; opts: Record<string, unknown> }> = [];
  const client = {
    // 1ª chamada: a página pedida. Chamadas seguintes: a consulta de confirmação do fim do histórico.
    getMessages: async (peer: unknown, opts: Record<string, unknown>) => {
      calls.push({ peer, opts });
      return calls.length === 1 ? messages : probe;
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

  test('página cheia: ainda há histórico, sem gastar uma consulta de confirmação', async () => {
    const full = Array.from({ length: PERSONAL_PAGE_SIZE }, (_, i) => video(PERSONAL_PAGE_SIZE - i));
    const calls = fakeClient(full);
    expect(await fetchPersonalVideoPage('cine_ch')).toMatchObject({ exhausted: false, oldestId: '1' });
    expect(calls).toHaveLength(1);
  });

  test('página curta: só acaba se a consulta de confirmação, logo antes da mais antiga, vier vazia', async () => {
    const calls = fakeClient([video(7), video(6)], []);
    expect(await fetchPersonalVideoPage('cine_ch', { query: 'x' })).toMatchObject({ exhausted: true, oldestId: '6' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.opts).toMatchObject({ limit: 1, offsetId: 6, search: 'x' });
    expect(calls[1]?.opts.filter).toBeInstanceOf(Api.InputMessagesFilterVideo);
  });

  test('o Telegram devolveu página curta mas ainda há histórico: NÃO encerra (o cursor seguiria e nunca alcançaria o resto)', async () => {
    fakeClient([video(7), video(6)], [video(5)]);
    expect(await fetchPersonalVideoPage('cine_ch')).toMatchObject({ exhausted: false, oldestId: '6' });
  });

  test('mensagem que não é vídeo conta para o fim do histórico, mas não vira item', async () => {
    fakeClient([video(8), photo(7)]);
    const page = await fetchPersonalVideoPage('cine_ch');
    expect(page.items.map((i) => i.messageId)).toEqual(['8']);
    expect(page.oldestId).toBe('7');
  });

  test('página vazia: acabou e não há id mais antigo', async () => {
    const calls = fakeClient([]);
    expect(await fetchPersonalVideoPage('cine_ch')).toEqual({ items: [], exhausted: true, oldestId: null });
    expect(calls).toHaveLength(1);
  });

  test('fetchPersonalChannelItems segue devolvendo só a lista', async () => {
    fakeClient([video(3, 'Legenda')]);
    expect(await fetchPersonalChannelItems('cine_ch')).toEqual([
      {
        messageId: '3',
        caption: 'Legenda',
        durationSeconds: null,
        postedAt: new Date((1_790_000_000 + 3) * 1000).toISOString(),
        width: null,
        height: null,
        supportsStreaming: null,
        fileName: null,
      },
    ]);
  });
});
