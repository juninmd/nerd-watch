import { describe, expect, test } from 'bun:test';
import { versionLabel } from '../../src/client/platform/version.ts';

describe('versão instalada na UI', () => {
  test('mostra a versão do app com o prefixo "v"', () => {
    expect(versionLabel('0.3.1')).toBe('versão instalada: v0.3.1');
  });

  test('no navegador (sem app instalado) não mostra linha nenhuma', () => {
    expect(versionLabel(null)).toBeNull();
    expect(versionLabel('')).toBeNull();
  });
});

describe('estado de versão (Ajustes)', () => {
  test('sem versão em uso, não há o que mostrar', async () => {
    const { resolveVersionStatus } = await import('../../src/client/platform/version-info.ts');
    // Sem Tauri e sem servidor, não há versão em uso: nada a mostrar.
    expect(await resolveVersionStatus()).toBeNull();
  });
});
