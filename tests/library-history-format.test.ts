import { describe, expect, test } from 'bun:test';
import { describeHistoryEvent } from '../src/client/library-history-format.ts';

describe('rótulos do histórico da lista', () => {
  test('cada tipo de evento tem um rótulo em português', () => {
    expect(describeHistoryEvent('added', null)).toBe('Adicionado à lista');
    expect(describeHistoryEvent('started', null)).toBe('Começou a assistir');
    expect(describeHistoryEvent('finished', null)).toBe('Marcado como assistido');
    expect(describeHistoryEvent('dropped', null)).toBe('Abandonado');
    expect(describeHistoryEvent('rewatch_started', null)).toBe('Revisão iniciada');
  });

  test('progresso mostra temporada e episódio gravados', () => {
    expect(describeHistoryEvent('progress', 'T2 E5')).toBe('Progresso: T2 E5');
  });

  test('mudança de status traduz os dois lados da transição', () => {
    expect(describeHistoryEvent('status_changed', 'dropped->want')).toBe('Status alterado: abandonado → quero ver');
  });

  test('detalhe desconhecido nunca quebra: cai no rótulo do tipo', () => {
    expect(describeHistoryEvent('status_changed', null)).toBe('Status alterado');
    expect(describeHistoryEvent('progress', null)).toBe('Progresso');
  });
});
