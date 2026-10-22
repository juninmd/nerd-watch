import { describe, expect, test } from 'bun:test';
import { Api } from 'teleproto';
import { channelInfoFromDialog } from '../src/server/providers/telegram/personal-channels.ts';

const channel = (fields: Record<string, unknown>) => Object.assign(Object.create(Api.Channel.prototype), fields) as Api.Channel;
// big-integer é dependência transitiva do teleproto: o handle só usa `String(id)`, então um toString basta.
const id = (value: string) => ({ toString: () => value });

describe('channelInfoFromDialog', () => {
  test('canal público: devolve título, @usuário e membros', () => {
    const entity = channel({ title: 'Cine', username: 'cine_ch', participantsCount: 1200 });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: false, title: 'Cine', entity })).toEqual({
      title: 'Cine',
      handle: 'cine_ch',
      members: 1200,
      kind: 'channel',
    });
  });

  test('canal privado: vira c/<id>, importável pela conta pessoal', () => {
    const entity = channel({ title: 'Privado', id: id('2675951342') });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: false, title: 'Privado', entity })).toEqual({
      title: 'Privado',
      handle: 'c/2675951342',
      members: null,
      kind: 'channel',
    });
  });

  test('usa o @usuário ativo quando o canal só tem usernames[]', () => {
    const entity = channel({ title: 'X', usernames: [{ username: 'velho', active: false }, { username: 'atual_ch', active: true }] });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: false, title: 'X', entity })?.handle).toBe('atual_ch');
  });

  test('supergrupo privado e público entram, marcados como grupo', () => {
    const privado = channel({ title: 'Grupo', id: id('1234567890') });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: true, title: 'Grupo', entity: privado })).toMatchObject({ handle: 'c/1234567890', kind: 'group' });
    const publico = channel({ title: 'Grupo', username: 'grupo_x' });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: true, title: 'Grupo', entity: publico })).toMatchObject({ handle: 'grupo_x', kind: 'group' });
  });

  test('ignora conversas diretas e grupos antigos (sem id de canal)', () => {
    expect(channelInfoFromDialog({ isChannel: false, isGroup: false, title: 'Fulano', entity: undefined })).toBeNull();
    const legacy = Object.assign(Object.create(Api.Chat.prototype), { title: 'Antigo' });
    expect(channelInfoFromDialog({ isChannel: false, isGroup: true, title: 'Antigo', entity: legacy })).toBeNull();
  });
});
