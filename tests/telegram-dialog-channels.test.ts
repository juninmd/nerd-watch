import { describe, expect, test } from 'bun:test';
import { Api } from 'teleproto';
import { channelInfoFromDialog } from '../src/server/providers/telegram/personal.ts';

const channel = (fields: Record<string, unknown>) => Object.assign(Object.create(Api.Channel.prototype), fields) as Api.Channel;

describe('channelInfoFromDialog', () => {
  test('canal público: devolve título, @usuário e membros', () => {
    const entity = channel({ title: 'Cine', username: 'cine_ch', participantsCount: 1200 });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: false, title: 'Cine', entity })).toEqual({ title: 'Cine', handle: 'cine_ch', members: 1200 });
  });

  test('canal privado: handle nulo (não dá pra importar por @usuário)', () => {
    const entity = channel({ title: 'Privado' });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: false, title: 'Privado', entity })).toEqual({ title: 'Privado', handle: null, members: null });
  });

  test('usa o @usuário ativo quando o canal só tem usernames[]', () => {
    const entity = channel({ title: 'X', usernames: [{ username: 'velho', active: false }, { username: 'atual_ch', active: true }] });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: false, title: 'X', entity })?.handle).toBe('atual_ch');
  });

  test('ignora grupos, conversas e supergrupos', () => {
    const entity = channel({ title: 'Grupo', username: 'grupo_x' });
    expect(channelInfoFromDialog({ isChannel: true, isGroup: true, title: 'Grupo', entity })).toBeNull();
    expect(channelInfoFromDialog({ isChannel: false, isGroup: false, title: 'Fulano', entity: undefined })).toBeNull();
  });
});
