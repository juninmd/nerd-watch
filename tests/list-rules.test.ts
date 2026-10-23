import { describe, expect, test } from 'bun:test';
import { LIST_DESCRIPTION_MAX, LIST_NAME_MAX, checkPermutation, moveItem, orderByPosition, validateDescription, validateListName, validateTitleIds } from '../src/server/lists/rules.ts';
import { ValidationError } from '../src/server/validation-error.ts';

describe('validateListName', () => {
  test('aceita acentos e emoji e remove espaços das pontas', () => {
    expect(validateListName('  Terror à noite 🎃  ')).toBe('Terror à noite 🎃');
  });

  test('rejeita vazio, só espaços e valores que não são texto', () => {
    for (const bad of ['', '   ', null, 42, ['a'], { name: 'a' }]) {
      expect(() => validateListName(bad)).toThrow(ValidationError);
    }
  });

  test('conta caracteres (code points), não bytes: 80 emojis cabem, 81 não', () => {
    expect(validateListName('😀'.repeat(LIST_NAME_MAX))).toBe('😀'.repeat(LIST_NAME_MAX));
    expect(() => validateListName('😀'.repeat(LIST_NAME_MAX + 1))).toThrow(ValidationError);
  });

  test('rejeita quebra de linha e caracteres de controle (o nome vai para uma linha só na UI)', () => {
    expect(() => validateListName('linha\nnova')).toThrow(ValidationError);
    expect(() => validateListName('nulo\u0000aqui')).toThrow(ValidationError);
  });

  test('texto com cara de injeção é só texto: a validação não o interpreta nem o altera', () => {
    const hostile = `x'); DROP TABLE lists;--`;
    expect(validateListName(hostile)).toBe(hostile);
  });
});

describe('validateDescription', () => {
  test('ausente ou nulo vira null; string vazia também', () => {
    expect(validateDescription(undefined)).toBeNull();
    expect(validateDescription(null)).toBeNull();
    expect(validateDescription('   ')).toBeNull();
  });

  test('aceita quebra de linha comum, rejeita controle e passar do limite', () => {
    expect(validateDescription('primeira\nsegunda')).toBe('primeira\nsegunda');
    expect(() => validateDescription('ok\u0007')).toThrow(ValidationError);
    expect(() => validateDescription('x'.repeat(LIST_DESCRIPTION_MAX + 1))).toThrow(ValidationError);
    expect(() => validateDescription(7)).toThrow(ValidationError);
  });
});

describe('validateTitleIds', () => {
  test('recusa lista vazia quando exigida, não-array, id vazio e acima do teto', () => {
    expect(() => validateTitleIds([], 10)).toThrow(ValidationError);
    expect(() => validateTitleIds('a', 10)).toThrow(ValidationError);
    expect(() => validateTitleIds(['a', ''], 10)).toThrow(ValidationError);
    expect(() => validateTitleIds(['a', 1], 10)).toThrow(ValidationError);
    expect(() => validateTitleIds(['a', 'b', 'c'], 2)).toThrow(ValidationError);
  });

  test('remove duplicados sem erro: adicionar o mesmo título duas vezes é idempotente', () => {
    expect(validateTitleIds(['a', 'b', 'a'], 10)).toEqual(['a', 'b']);
  });
});

describe('checkPermutation (reordenação)', () => {
  test('aceita a mesma coleção em outra ordem', () => {
    expect(checkPermutation(['a', 'b', 'c'], ['c', 'a', 'b'])).toBeNull();
  });

  test('aceita lista vazia (nada a reordenar)', () => {
    expect(checkPermutation([], [])).toBeNull();
  });

  test('recusa duplicado, item faltando e item de fora', () => {
    expect(checkPermutation(['a', 'b'], ['a', 'a'])).toContain('duplicado');
    expect(checkPermutation(['a', 'b'], ['a'])).toContain('tamanho');
    expect(checkPermutation(['a', 'b'], ['a', 'z'])).toContain('não pertence');
  });
});

describe('moveItem (subir/descer)', () => {
  test('primeiro item não sobe e último não desce: a ordem fica igual', () => {
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  test('troca com o vizinho no meio da lista e não muda o array original', () => {
    const original = ['a', 'b', 'c'];
    expect(moveItem(original, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(original, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(original).toEqual(['a', 'b', 'c']);
  });

  test('lista de um item e índice fora da faixa', () => {
    expect(moveItem(['a'], 0, 1)).toEqual(['a']);
    expect(() => moveItem(['a'], 1, 1)).toThrow(ValidationError);
    expect(() => moveItem(['a'], -1, 1)).toThrow(ValidationError);
  });

  test('delta só pode ser -1 ou 1', () => {
    expect(() => moveItem(['a', 'b'], 0, 2 as 1)).toThrow(ValidationError);
  });
});

describe('orderByPosition (posições repetidas ou com buracos)', () => {
  test('posições iguais desempatam por data de inclusão e depois pelo id, sempre igual', () => {
    const rows = [
      { titleId: 'c', position: 1, addedAt: '2026-01-02' },
      { titleId: 'b', position: 1, addedAt: '2026-01-01' },
      { titleId: 'a', position: 1, addedAt: '2026-01-01' },
      { titleId: 'd', position: 0, addedAt: '2026-03-01' },
    ];
    expect(orderByPosition(rows)).toEqual(['d', 'a', 'b', 'c']);
    expect(orderByPosition([...rows].reverse())).toEqual(['d', 'a', 'b', 'c']);
  });
});
