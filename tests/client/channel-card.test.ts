import { describe, expect, test } from 'bun:test';
import { uploadDate, videoFacts } from '../../src/client/channels/telegram-items.ts';

describe('uploadDate', () => {
  test('formata em pt-BR e devolve o ISO; inválida ou ausente vira null', () => {
    expect(uploadDate('2026-11-12T15:00:00Z')?.label).toMatch(/12.*nov.*2026/);
    expect(uploadDate('lixo')).toBeNull();
    expect(uploadDate(null)).toBeNull();
  });
});

describe('videoFacts', () => {
  test('card mostra o nome do arquivo cru (o JSX escapa) e a data de upload com ISO para o datetime', () => {
    expect(videoFacts({ fileName: ' ep<1>.mkv ', postedAt: '2026-11-12T15:00:00Z' })).toEqual([
      { kind: 'file', label: 'ep<1>.mkv' },
      { kind: 'posted', label: expect.stringMatching(/12.*nov.*2026/), iso: '2026-11-12T15:00:00.000Z' },
    ]);
  });

  test('sem arquivo nem data não gera linhas vazias', () => {
    expect(videoFacts({ fileName: null, postedAt: null })).toEqual([]);
    expect(videoFacts({ fileName: '  ', postedAt: 'lixo' })).toEqual([]);
  });
});
