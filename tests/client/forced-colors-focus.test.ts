import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tokens = readFileSync(join(import.meta.dir, '../../src/client/styles/tokens.css'), 'utf8');
const forced = tokens.slice(tokens.indexOf('@media (forced-colors: active)'));

// `.input:focus-visible { outline: none }` vence o `:focus-visible` global por especificidade;
// sem esta regra o foco dos campos some no modo de alto contraste (sombra e cor de borda são ignoradas).
describe('foco em forced-colors', () => {
  for (const sel of ['.input:focus-visible', '.select:focus-visible', '.textarea:focus-visible']) {
    test(`${sel} tem contorno do sistema`, () => {
      expect(forced).toContain(sel);
    });
  }
});
