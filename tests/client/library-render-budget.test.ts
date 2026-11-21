import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = (name: string): string => readFileSync(join(import.meta.dir, `../../src/client/styles/${name}`), 'utf8');

// Biblioteca com milhares de títulos: sem estas regras cada tecla no filtro redesenhava a grade inteira (~2–3 s com 5000).
describe('orçamento de render da biblioteca', () => {
  test('cards fora da tela pulam layout e pintura, com tamanho reservado', () => {
    const lib = css('library.css');
    expect(lib).toMatch(/#lib-list \.grid > \.card \{[^}]*content-visibility: auto;[^}]*contain-intrinsic-size: auto/);
    expect(lib).toMatch(/#lib-list \.grid\.as-list > \.card \{[^}]*contain-intrinsic-size: auto/);
  });

  test('a cascata de entrada não anima cards além da primeira tela', () => {
    expect(css('effects.css')).toMatch(/\.grid > \.card:nth-child\(n \+ 41\)[^{]*\{ animation: none; \}/);
  });
});
