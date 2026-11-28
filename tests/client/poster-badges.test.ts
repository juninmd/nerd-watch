import { describe, expect, test } from 'bun:test';
import { posterFlag, scoreLabel } from '../../src/client/ui/poster-badges.ts';

describe('selos do pôster', () => {
  test('episódio novo vence "continuar": é o que muda o que a pessoa faz agora', () => {
    expect(posterFlag('watching', 3)).toEqual({ kind: 'new', label: '3 ep. novos' });
    expect(posterFlag('watching', 1)).toEqual({ kind: 'new', label: '1 ep. novo' });
    expect(posterFlag('watching', 0)).toEqual({ kind: 'continue', label: 'continuar' });
  });

  test('fora de "assistindo" e sem novidade não há selo de ação', () => {
    expect(posterFlag('want')).toBeNull();
    expect(posterFlag('watched')).toBeNull();
    expect(posterFlag(undefined)).toBeNull();
  });

  test('nota com uma casa; zero, ausente ou inválida some', () => {
    expect(scoreLabel(7.84)).toBe('7.8');
    expect(scoreLabel(8)).toBe('8.0');
    expect(scoreLabel(12)).toBe('10.0');
    expect(scoreLabel(0)).toBeNull();
    expect(scoreLabel(null)).toBeNull();
    expect(scoreLabel(Number.NaN)).toBeNull();
  });
});
