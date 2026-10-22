import { describe, expect, test } from 'bun:test';
import { CsvError, guardCell, parseCsv, toCsv, unguardCell } from '../src/server/providers/library-io/csv.ts';

describe('toCsv / parseCsv: RFC 4180', () => {
  test('ida e volta preserva vírgula, aspas, quebra de linha e unicode', () => {
    const rows = [
      ['a,b', 'diz "oi"', 'linha1\nlinha2', 'ação 🎬 日本'],
      ['', 'x\r\ny', ' espaço ', 'é'],
    ];
    const csv = toCsv(rows);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parseCsv(csv).map((r) => r.cells)).toEqual(rows);
  });

  test('aceita CRLF e LF na leitura e ignora linhas em branco', () => {
    const recs = parseCsv('a,b\r\n\n1,2\n\r\n3,4');
    expect(recs.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  test('remove o BOM UTF-8 do início (Excel salva com ele)', () => {
    expect(parseCsv('﻿titulo,ano\r\nFilme,2001').map((r) => r.cells)).toEqual([
      ['titulo', 'ano'],
      ['Filme', '2001'],
    ]);
  });

  test('aspa sem fechamento é erro, não engole o resto do arquivo em silêncio', () => {
    expect(() => parseCsv('a,"b\nc')).toThrow(CsvError);
  });

  test('aspa solta no meio de campo sem aspas é texto literal', () => {
    expect(parseCsv('a"b,c')[0]?.cells).toEqual(['a"b', 'c']);
  });

  test('número de linha aponta o início do registro, mesmo depois de quebra dentro de aspas', () => {
    const recs = parseCsv('h\r\n"x\ny"\r\nz');
    expect(recs.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  test('último registro sem quebra final e com célula vazia entre aspas não se perde', () => {
    expect(parseCsv('a,""').map((r) => r.cells)).toEqual([['a', '']]);
  });
});

describe('neutralização de fórmulas (CSV injection)', () => {
  test.each(['=1+1', '+SUM(A1)', '-2', '@cmd', '\tcalc', '\rcalc', ' =x', "'já com aspas", "''", "'"])(
    'exporta com guarda e importa de volta o valor original: %j',
    (value) => {
      expect(unguardCell(guardCell(value))).toBe(value);
    },
  );

  test('célula que começaria fórmula ganha apóstrofo inicial', () => {
    expect(guardCell('=HYPERLINK("http://exemplo.test")')).toBe(`'=HYPERLINK("http://exemplo.test")`);
    expect(guardCell('\tx')).toBe("'\tx");
    expect(guardCell('\rx')).toBe("'\rx");
  });

  test('texto comum não ganha apóstrofo', () => {
    for (const v of ['Matrix', 'Amélie', '2001: Odisseia no Espaço', 'a=b', 'x-y']) expect(guardCell(v)).toBe(v);
  });

  test('importar um título que começa com apóstrofo sem marca preserva o apóstrofo', () => {
    expect(unguardCell("'Til Death")).toBe("'Til Death");
  });
});
