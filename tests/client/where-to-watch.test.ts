import { describe, expect, test } from 'bun:test';
import { providerGroups } from '../../src/client/catalog/where-to-watch.tsx';

const empty = { link: null, flatrate: [], rent: [], buy: [] };

describe('providerGroups', () => {
  test('sem nenhum serviço não há grupo (o painel explica em vez de ficar vazio)', () => {
    expect(providerGroups(empty)).toEqual([]);
  });

  test('agrupa por tipo de acesso com a contagem e omite grupos vazios', () => {
    const labels = providerGroups({
      ...empty,
      flatrate: [
        { name: 'A', logoUrl: null },
        { name: 'B', logoUrl: null },
      ],
      buy: [{ name: 'C', logoUrl: null }],
    }).map((g) => g.label);
    expect(labels).toEqual(['Incluso na assinatura (2)', 'Comprar (1)']);
  });
});
