import { describe, expect, test } from 'bun:test';
import { bumpVersion, commitBump, nextVersion, parseVersion } from '../../src/shared/release-version.ts';

/**
 * Versão automática a partir de commits. O que importa aqui é o que NÃO publica: um `docs:` ou um
 * `Merge pull request` criando release faria o auto-update de todo mundo baixar uma versão vazia, e
 * um `BREAKING CHANGE` ignorado deixaria os apps antigos presos numa versão incompatível.
 */

describe('commitBump: tipos convencionais', () => {
  test('feat sobe minor, fix/perf/refactor sobem patch', () => {
    expect(commitBump({ subject: 'feat: busca por título' })).toBe('minor');
    expect(commitBump({ subject: 'fix: player não retoma' })).toBe('patch');
    expect(commitBump({ subject: 'perf: índice da biblioteca' })).toBe('patch');
    expect(commitBump({ subject: 'refactor: separa repo de rotas' })).toBe('patch');
  });

  test('escopo e descrição não mudam o tipo', () => {
    expect(commitBump({ subject: 'feat(torrent): escolhe derivado' })).toBe('minor');
  });

  test('! no cabeçalho é breaking', () => {
    expect(commitBump({ subject: 'feat(api)!: troca o formato do backup' })).toBe('major');
  });

  test('rodapé BREAKING CHANGE no corpo é breaking mesmo em tipo de patch', () => {
    expect(commitBump({ subject: 'fix: ajusta sync', body: 'detalhe\n\nBREAKING CHANGE: sem retomada' })).toBe('major');
  });

  test('breaking vindo de tipo sem release ainda publica (a quebra precisa de versão)', () => {
    expect(commitBump({ subject: 'docs!: reorganiza a doc pública' })).toBe('major');
  });
});

describe('commitBump: o que não publica', () => {
  test('docs, chore, test, ci, build e style não pedem release', () => {
    for (const type of ['docs', 'chore', 'test', 'ci', 'build', 'style']) {
      expect(commitBump({ subject: `${type}: mexe em nada de produção` })).toBeNull();
    }
  });

  test('commit fora do padrão convencional é ignorado', () => {
    expect(commitBump({ subject: 'Reorganiza a arquitetura e acelera a casca (#64)' })).toBeNull();
    expect(commitBump({ subject: 'feat:' })).toBeNull();
  });

  test('merge commit e commit de release não contam', () => {
    expect(commitBump({ subject: 'Merge pull request #70 from juninmd/feat/x' })).toBeNull();
    expect(commitBump({ subject: 'chore(release): v0.2.0' })).toBeNull();
  });
});

describe('nextVersion: maior bump vence', () => {
  test('fix + feat => minor', () => {
    expect(nextVersion('0.1.0', [{ subject: 'fix: a' }, { subject: 'feat: b' }])).toEqual({
      version: '0.2.0',
      bump: 'minor',
    });
  });

  test('breaking + feat => major e zera minor/patch', () => {
    expect(nextVersion('1.4.7', [{ subject: 'feat: a' }, { subject: 'refactor!: b' }])).toEqual({
      version: '2.0.0',
      bump: 'major',
    });
  });

  test('sem commit que peça release => null (nenhum release é criado)', () => {
    expect(nextVersion('0.1.0', [{ subject: 'docs: readme' }, { subject: 'chore: deps' }])).toBeNull();
  });

  test('aceita a versão atual com prefixo v', () => {
    expect(nextVersion('v1.2.3', [{ subject: 'fix: a' }])?.version).toBe('1.2.4');
  });

  test('versão atual inválida não vira NaN', () => {
    expect(nextVersion('latest', [{ subject: 'feat: a' }])).toBeNull();
  });
});

describe('parseVersion/bumpVersion', () => {
  test('patch sobe o último dígito, minor zera patch', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  test('parseVersion aceita v e rejeita pré-release', () => {
    expect(parseVersion('v2.0.1')).toEqual([2, 0, 1]);
    expect(parseVersion('1.0.0-beta.1')).toBeNull();
  });
});
