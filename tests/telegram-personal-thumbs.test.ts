import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Api } from 'teleproto';
import * as personal from '../src/server/providers/telegram/personal.ts';
import { fetchPersonalThumbs } from '../src/server/providers/telegram/personal-info.ts';

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

const size = (w: number) => Object.assign(Object.create(Api.PhotoSize.prototype), { w, h: w });
const videoMessage = (id: number, withThumb = true) =>
  Object.assign(Object.create(Api.Message.prototype), {
    id,
    media: Object.assign(Object.create(Api.MessageMediaDocument.prototype), {
      document: Object.assign(Object.create(Api.Document.prototype), { thumbs: withThumb ? [size(90), size(320)] : [] }),
    }),
  });

/** Cliente falso: cada download leva um instante e registra quantos estavam em andamento ao mesmo tempo. */
const fakeClient = (messages: unknown[], fail: (id: number) => boolean = () => false) => {
  const state = { inflight: 0, peak: 0, downloaded: [] as number[] };
  const client = {
    getMessages: async () => messages,
    downloadMedia: async (msg: { id: number }) => {
      state.inflight++;
      state.peak = Math.max(state.peak, state.inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.inflight--;
      if (fail(msg.id)) throw new Error('download falhou');
      state.downloaded.push(msg.id);
      return Buffer.from([msg.id]);
    },
  };
  spies.push(spyOn(personal, 'withLiveSession').mockImplementation(async (fn) => fn(client as never)));
  return state;
};

describe('fetchPersonalThumbs', () => {
  test('baixa várias miniaturas ao mesmo tempo, mas com teto (10) (não é um download por vez, nem tudo de uma vez)', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const state = fakeClient(ids.map((id) => videoMessage(id)));
    const thumbs = await fetchPersonalThumbs('cine_ch', ids.map(String));
    expect([...thumbs.keys()].sort((a, b) => Number(a) - Number(b))).toEqual(ids.map(String));
    expect(state.peak).toBeGreaterThan(1);
    expect(state.peak).toBeLessThanOrEqual(10);
  });

  test('um download que falha não leva junto as outras miniaturas', async () => {
    fakeClient([videoMessage(1), videoMessage(2), videoMessage(3)], (id) => id === 2);
    const thumbs = await fetchPersonalThumbs('cine_ch', ['1', '2', '3']);
    expect([...thumbs.keys()].sort()).toEqual(['1', '3']);
  });

  test('vídeo sem miniatura no Telegram fica de fora, sem baixar o vídeo', async () => {
    const state = fakeClient([videoMessage(1, false), videoMessage(2)]);
    const thumbs = await fetchPersonalThumbs('cine_ch', ['1', '2']);
    expect([...thumbs.keys()]).toEqual(['2']);
    expect(state.downloaded).toEqual([2]);
  });

  test('sem ids não chama o Telegram', async () => {
    const state = fakeClient([]);
    expect((await fetchPersonalThumbs('cine_ch', [])).size).toBe(0);
    expect(state.peak).toBe(0);
  });
});
