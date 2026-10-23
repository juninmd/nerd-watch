import { describe, expect, test } from 'bun:test';
import { csvReportLines, malReportLines, REPORT_PROBLEM_LIMIT } from '../src/client/library-io-report.ts';

describe('csvReportLines: resumo e erros por linha', () => {
  test('resumo com as quatro contagens e uma linha por erro', () => {
    const lines = csvReportLines({
      imported: 2,
      updated: 1,
      unchanged: 3,
      failed: 1,
      errors: [{ row: 7, message: 'status deve ser um de: want, watching, watched, dropped' }],
    });
    expect(lines.summary).toBe('2 novos · 1 atualizados · 3 sem mudança · 1 com erro');
    expect(lines.problems).toEqual(['linha 7: status deve ser um de: want, watching, watched, dropped']);
  });

  test('sem erros não há lista de problemas', () => {
    expect(csvReportLines({ imported: 0, updated: 0, unchanged: 5, failed: 0, errors: [] }).problems).toEqual([]);
  });

  test(`muitos erros são cortados em ${REPORT_PROBLEM_LIMIT} e a sobra vira uma linha de resumo`, () => {
    const errors = Array.from({ length: REPORT_PROBLEM_LIMIT + 5 }, (_, i) => ({ row: i + 2, message: 'inválida' }));
    const { problems } = csvReportLines({ imported: 0, updated: 0, unchanged: 0, failed: errors.length, errors });
    expect(problems).toHaveLength(REPORT_PROBLEM_LIMIT + 1);
    expect(problems.at(-1)).toBe('e mais 5 linhas com erro');
  });
});

describe('malReportLines: entradas sem correspondência', () => {
  test('explica por que entradas ficaram de fora quando não há correspondência offline', () => {
    const lines = malReportLines({
      entries: 2,
      imported: 0,
      updated: 0,
      unchanged: 0,
      unresolved: [
        { row: 1, malId: 1001, title: 'Anime Fictício', watchStatus: 'watched' },
        { row: 2, malId: 1002, title: '', watchStatus: 'want' },
      ],
      errors: [],
    });
    expect(lines.summary).toBe('2 entradas lidas · 0 novas · 0 atualizadas · 2 sem correspondência');
    expect(lines.note).toContain('docs/providers/importers.md');
    expect(lines.problems).toEqual([
      'entrada 1 (id MAL 1001, Anime Fictício): sem título correspondente na biblioteca',
      'entrada 2 (id MAL 1002): sem título correspondente na biblioteca',
    ]);
  });

  test('erros de entrada aparecem junto e sem nota quando tudo foi resolvido', () => {
    const lines = malReportLines({
      entries: 1,
      imported: 1,
      updated: 0,
      unchanged: 0,
      unresolved: [],
      errors: [{ row: 3, message: 'my_score deve ser um inteiro de 0 a 10' }],
    });
    expect(lines.note).toBeUndefined();
    expect(lines.problems).toEqual(['entrada 3: my_score deve ser um inteiro de 0 a 10']);
  });
});
