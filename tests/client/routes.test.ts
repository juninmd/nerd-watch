import { describe, expect, test } from 'bun:test';
import { canonicalPath, ROUTES, resolveRoute } from '../../src/client/app/routes.ts';

const idOf = (path: string): string | null => resolveRoute(path)?.def.id ?? null;

describe('resolveRoute', () => {
  test('cada caminho fixo cai na sua tela', () => {
    const fixed: Record<string, string> = {
      '/': 'home',
      '/search': 'search',
      '/library': 'library',
      '/lists': 'lists',
      '/agenda': 'calendar',
      '/stats': 'stats',
      '/public-domain': 'publicDomain',
      '/telegram': 'channels',
      '/connections': 'connections',
    };
    for (const [path, id] of Object.entries(fixed)) expect(idOf(path)).toBe(id);
  });

  test('rotas com parâmetro devolvem os grupos na ordem', () => {
    expect(resolveRoute('/title/tmdb/tv/1399')).toMatchObject({ def: { id: 'title' }, params: ['tmdb', 'tv', '1399'] });
    expect(resolveRoute('/title/archive/_/night_of_the_living_dead')?.params).toEqual(['archive', '_', 'night_of_the_living_dead']);
    expect(resolveRoute('/telegram/abc%20def')).toMatchObject({ def: { id: 'channel' }, params: ['abc%20def'] });
    expect(resolveRoute('/lists/minha-lista')).toMatchObject({ def: { id: 'listDetail' }, params: ['minha-lista'] });
    expect(resolveRoute('/watch/canal-1/42')).toMatchObject({ def: { id: 'watch' }, params: ['canal-1', '42'] });
    expect(idOf('/watch/canal-1/start')).toBe('watch');
  });

  test('caminho desconhecido ou malformado não casa com nada', () => {
    for (const path of ['/nada', '/title/outra/tv/1', '/title/tmdb/serie/1', '/watch/canal/abc', '/lists/a/b', '/library/x', '']) {
      expect(idOf(path)).toBeNull();
    }
  });

  test('cada tela aparece uma vez na tabela', () => {
    const ids = ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('canonicalPath', () => {
  test('rotas antigas apontam para as novas; o resto passa direto', () => {
    expect(canonicalPath('/my-list')).toBe('/library');
    expect(canonicalPath('/calendar')).toBe('/agenda');
    expect(canonicalPath('/stats')).toBe('/stats');
  });
});
