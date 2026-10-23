import { ValidationError } from '../validation-error.ts';
import { CR, LF, TAB, hasControlChar } from '../text-guards.ts';

export const LIST_NAME_MAX = 80;
export const LIST_DESCRIPTION_MAX = 500;
/** Teto por lista: mantém a reordenação (que reescreve todas as posições) barata e limitada. */
export const LIST_ITEMS_MAX = 1000;
/** Teto por requisição de adição em lote (o mesmo da ação em lote da biblioteca). */
export const LIST_BULK_MAX = 500;
const TITLE_ID_MAX = 64;

const TEXT_ALLOWED = new Set([TAB, LF, CR]);
const NAME_ALLOWED = new Set<number>();

const codePoints = (s: string): number => [...s].length;

/** Nome: 1 a 80 caracteres (code points), sem quebra de linha nem controle. Devolve o texto aparado. */
export const validateListName = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new ValidationError('nome da lista deve ser texto');
  const name = raw.trim();
  if (name === '') throw new ValidationError('nome da lista não pode ser vazio');
  if (codePoints(name) > LIST_NAME_MAX) throw new ValidationError(`nome da lista com mais de ${LIST_NAME_MAX} caracteres`);
  if (hasControlChar(name, NAME_ALLOWED)) throw new ValidationError('nome da lista não aceita quebra de linha nem caracteres de controle');
  return name;
};

/** Descrição opcional: vazia vira null. Quebra de linha é permitida; controle, não. */
export const validateDescription = (raw: unknown): string | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new ValidationError('descrição deve ser texto');
  const text = raw.trim();
  if (text === '') return null;
  if (codePoints(text) > LIST_DESCRIPTION_MAX) throw new ValidationError(`descrição com mais de ${LIST_DESCRIPTION_MAX} caracteres`);
  if (hasControlChar(text, TEXT_ALLOWED)) throw new ValidationError('descrição não aceita caracteres de controle');
  return text;
};

/** Forma da lista de ids (sem regra de duplicado: cada chamador decide). */
export const readTitleIds = (raw: unknown, max: number): string[] => {
  if (!Array.isArray(raw)) throw new ValidationError('titleIds deve ser uma lista de ids');
  if (raw.length > max) throw new ValidationError(`no máximo ${max} itens por vez`);
  for (const id of raw) {
    if (typeof id !== 'string' || id === '' || id.length > TITLE_ID_MAX) throw new ValidationError('id de título inválido');
  }
  return raw as string[];
};

/** Para adicionar: não vazia, com duplicados removidos (adicionar 2x é idempotente). */
export const validateTitleIds = (raw: unknown, max: number): string[] => {
  const ids = readTitleIds(raw, max);
  if (ids.length === 0) throw new ValidationError('informe ao menos um título');
  return [...new Set(ids)];
};

/**
 * Reordenação: `next` tem que ser exatamente a mesma coleção de `current`, em outra ordem.
 * Devolve o motivo da recusa, ou null quando a permutação é válida.
 */
export const checkPermutation = (current: string[], next: string[]): string | null => {
  if (next.length !== current.length) return `tamanho diferente: a lista tem ${current.length} itens e a ordem enviada tem ${next.length}`;
  const seen = new Set<string>();
  for (const id of next) {
    if (seen.has(id)) return `item duplicado na ordem: ${id}`;
    seen.add(id);
  }
  const existing = new Set(current);
  for (const id of next) if (!existing.has(id)) return 'a ordem contém um título que não pertence à lista';
  return null;
};

/** Sobe (-1) ou desce (+1) um item. Na borda (primeiro subindo, último descendo) a ordem não muda. Não altera o original. */
export const moveItem = (ids: string[], index: number, delta: -1 | 1): string[] => {
  if (delta !== -1 && delta !== 1) throw new ValidationError('deslocamento deve ser -1 ou 1');
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) throw new ValidationError('posição fora da lista');
  const next = [...ids];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target] as string, next[index] as string];
  return next;
};

export interface PositionedRow {
  titleId: string;
  position: number;
  addedAt: string;
}

/**
 * Ordem de exibição: posição, depois data de inclusão, depois id do título. Posições repetidas (ou com buracos)
 * ficam determinísticas; o SQL usa o mesmo critério.
 */
export const orderByPosition = (rows: PositionedRow[]): string[] =>
  [...rows]
    .sort((a, b) => a.position - b.position || (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0) || (a.titleId < b.titleId ? -1 : a.titleId > b.titleId ? 1 : 0))
    .map((r) => r.titleId);
