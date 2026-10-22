import { describe, expect, test } from 'bun:test';
import { handleLabel, isPrivateHandle, originLabel } from '../src/client/source-modes.ts';

describe('rótulos de handle do Telegram', () => {
  test('público mostra @usuário; privado mostra o nome, nunca o c/<id>', () => {
    expect(handleLabel('cine_ch')).toBe('@cine_ch');
    expect(handleLabel('cine_ch', 'Cine')).toBe('@cine_ch');
    expect(handleLabel('c/2675951342', 'Filmes da turma')).toBe('Filmes da turma');
    expect(handleLabel('c/2675951342')).toBe('canal privado');
  });

  test('só a forma c/<números> é privada', () => {
    expect(isPrivateHandle('c/2675951342')).toBe(true);
    for (const other of ['c/', 'c/abc', 'canal_c', 'x/123']) expect(isPrivateHandle(other)).toBe(false);
  });

  test('o cartão do canal privado não expõe o id interno', () => {
    expect(originLabel('personal', 'c/2675951342')).toBe('canal privado');
    expect(originLabel('public', 'cine_ch')).toBe('@cine_ch');
    expect(originLabel('drive', 'qualquer')).toBe('google drive');
  });
});
