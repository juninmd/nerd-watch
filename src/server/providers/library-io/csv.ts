/**
 * CSV RFC 4180 sem dependência, e a neutralização de injeção de fórmula. Escrita sempre em CRLF; leitura aceita CRLF ou LF.
 * Aspa sem fechamento é erro (senão o resto do arquivo some em silêncio); aspa solta no meio de campo sem aspas é texto.
 */
export class CsvError extends Error {}

export interface CsvRecord {
  /** Linha física onde o registro começa (1-based), mesmo que ocupe várias linhas por causa de aspas. */
  line: number;
  cells: string[];
}

/** Lê o CSV inteiro. Linhas em branco são ignoradas. */
export const parseCsv = (input: string): CsvRecord[] => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let dirty = false;
  let line = 1;
  let recordLine = 1;

  const finish = (): void => {
    cells.push(cell);
    if (cells.length > 1 || cells[0] !== '') records.push({ line: recordLine, cells });
    cells = [];
    cell = '';
    dirty = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      finish();
      line++;
      recordLine = line;
      i++;
    } else if (ch === '\n' || ch === '\r') {
      // CR sozinho também termina registro: arquivos de Mac antigo e CRs soltos no fim não viram parte da célula.
      finish();
      line++;
      recordLine = line;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
      dirty = true;
    } else if (ch === '"' && cell === '') {
      quoted = true;
      dirty = true;
    } else {
      cell += ch;
      dirty = true;
    }
  }
  if (quoted) throw new CsvError(`aspas sem fechamento a partir da linha ${recordLine}`);
  if (dirty) finish();
  return records;
};

const needsQuotes = (value: string): boolean => /[",\r\n]/.test(value);
const quote = (value: string): string => (needsQuotes(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Escreve as linhas em CRLF, com aspas só onde o RFC exige. */
export const toCsv = (rows: string[][]): string => `${rows.map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`;

/**
 * Célula que o Excel/Calc/Sheets executaria como fórmula ou comando (= + - @, tab ou CR, com espaço à esquerda também).
 * Também marca quem já começa com apóstrofo, para a importação poder desfazer a marca sem ambiguidade.
 */
const GUARD_NEEDED = /^(?:'|[\t\r]|[ ]*[=+\-@])/;
/** Marca de neutralização seguida do que precisava dela: a importação tira só esse apóstrofo. */
const GUARDED = /^'(?:'|[\t\r]|[ ]*[=+\-@])/;

export const guardCell = (value: string): string => (GUARD_NEEDED.test(value) ? `'${value}` : value);
export const unguardCell = (value: string): string => (GUARDED.test(value) ? value.slice(1) : value);
