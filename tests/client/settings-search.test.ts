import { describe, expect, test } from 'bun:test';
import { reportIssueUrl } from '../../src/client/app/report-issue.ts';
import { matchSettings, SETTINGS_SECTIONS } from '../../src/client/app/settings-model.ts';

describe('busca nos Ajustes', () => {
  test('vazio mostra tudo', () => {
    expect(matchSettings('  ').size).toBe(SETTINGS_SECTIONS.length);
  });

  test('ignora acento e caixa e aceita prefixo e sinônimo', () => {
    expect([...matchSettings('APARENCIA')]).toEqual(['theme']);
    expect([...matchSettings('notif')]).toEqual(['notify']);
    expect([...matchSettings('bug')]).toEqual(['report']);
  });

  test('todas as palavras precisam bater', () => {
    expect(matchSettings('tema discord').size).toBe(0);
  });
});

describe('relatar problema', () => {
  const url = new URL(reportIssueUrl({ version: '1.2.3', installed: true, route: '/search?q=segredo', userAgent: 'UA/1' }));
  const body = url.searchParams.get('body') ?? '';

  test('abre a issue nova do repositório com rótulo bug', () => {
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/juninmd/nerd-watch/issues/new');
    expect(url.searchParams.get('labels')).toBe('bug');
  });

  test('leva versão e navegador, mas não a busca da URL', () => {
    expect(body).toContain('v1.2.3 (app desktop)');
    expect(body).toContain('UA/1');
    expect(body).toContain('- Tela: /search');
    expect(body).not.toContain('segredo');
  });
});
