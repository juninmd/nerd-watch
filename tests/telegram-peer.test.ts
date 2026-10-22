import { describe, expect, test } from 'bun:test';
import { Api } from 'teleproto';
import { PrivateChannelNotFoundError, resolvePeer } from '../src/server/providers/telegram/peer.ts';

// big-integer é dependência transitiva do teleproto: o resolvedor só compara `String(id)`, então um objeto com toString basta.
const big = (id: string) => ({ toString: () => id }) as never;
const channel = (id: string) => Object.assign(Object.create(Api.Channel.prototype), { id: big(id), title: `c${id}` }) as Api.Channel;
const inputPeer = (id: string) => Object.assign(Object.create(Api.InputPeerChannel.prototype), { channelId: big(id), accessHash: big('99') }) as Api.InputPeerChannel;

interface FakeDialog {
  entity?: unknown;
  inputEntity: Api.TypeInputPeer;
}

/** Cliente falso: devolve os diálogos por pasta e conta quantas varreduras foram feitas. */
const fakeClient = (folders: Record<number, FakeDialog[]>) => {
  const calls: Array<number | undefined> = [];
  return {
    calls,
    client: {
      iterDialogs(opts: { folder?: number; limit?: number }) {
        calls.push(opts.folder);
        const list = folders[opts.folder ?? 0] ?? [];
        return (async function* () {
          for (const d of list) yield d;
        })();
      },
    },
  };
};

describe('resolvePeer', () => {
  test('handle público passa direto, sem varrer diálogos', async () => {
    const { client, calls } = fakeClient({});
    expect(await resolvePeer(client, 'cine_ch')).toBe('cine_ch');
    expect(calls).toEqual([]);
  });

  test('canal privado: acha nos diálogos e devolve o InputPeer com o access hash', async () => {
    const wanted = inputPeer('2675951342');
    const { client } = fakeClient({ 0: [{ entity: channel('111'), inputEntity: inputPeer('111') }, { entity: channel('2675951342'), inputEntity: wanted }] });
    expect(await resolvePeer(client, 'c/2675951342')).toBe(wanted);
  });

  test('canal arquivado (pasta 1) também é achado', async () => {
    const wanted = inputPeer('2675951342');
    const { client, calls } = fakeClient({ 0: [], 1: [{ entity: channel('2675951342'), inputEntity: wanted }] });
    expect(await resolvePeer(client, 'c/2675951342')).toBe(wanted);
    expect(calls).toEqual([0, 1]);
  });

  test('a segunda chamada vem do cache: não varre de novo', async () => {
    const { client, calls } = fakeClient({ 0: [{ entity: channel('2675951342'), inputEntity: inputPeer('2675951342') }] });
    await resolvePeer(client, 'c/2675951342');
    await resolvePeer(client, 'c/2675951342');
    expect(calls).toEqual([0]);
  });

  test('conta que não participa do canal: erro claro, e não fica em cache', async () => {
    const { client, calls } = fakeClient({ 0: [{ entity: channel('111'), inputEntity: inputPeer('111') }], 1: [] });
    await expect(resolvePeer(client, 'c/2675951342')).rejects.toBeInstanceOf(PrivateChannelNotFoundError);
    await expect(resolvePeer(client, 'c/2675951342')).rejects.toBeInstanceOf(PrivateChannelNotFoundError);
    expect(calls).toEqual([0, 1, 0, 1]);
  });

  test('conversa direta com o mesmo número não é confundida com o canal', async () => {
    const user = Object.assign(Object.create(Api.User.prototype), { id: big('2675951342') });
    const userPeer = Object.assign(Object.create(Api.InputPeerUser.prototype), { userId: big('2675951342'), accessHash: big('1') });
    const { client } = fakeClient({ 0: [{ entity: user, inputEntity: userPeer }], 1: [] });
    await expect(resolvePeer(client, 'c/2675951342')).rejects.toBeInstanceOf(PrivateChannelNotFoundError);
  });
});
