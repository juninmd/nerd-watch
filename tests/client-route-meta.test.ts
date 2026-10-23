import { describe, expect, test } from 'bun:test';
import { routeLabel, routeTitle } from '../src/client/route-meta.ts';

const q = (s = '') => new URLSearchParams(s);

describe('routeTitle (aba e leitor de tela)', () => {
  test('cada seção tem nome próprio, não o genérico "nerd-watch"', () => {
    expect(routeTitle('/library', q())).toBe('Biblioteca · nerd-watch');
    expect(routeTitle('/agenda', q())).toBe('Agenda · nerd-watch');
    expect(routeTitle('/connections', q())).toBe('Conexões · nerd-watch');
  });

  test('rotas antigas usam o mesmo nome da rota atual', () => {
    expect(routeLabel('/my-list', q())).toBe(routeLabel('/library', q()));
    expect(routeLabel('/calendar', q())).toBe(routeLabel('/agenda', q()));
  });

  test('a busca mostra o termo, mas corta termos longos e ignora espaços', () => {
    expect(routeLabel('/search', q('q=%20%20dune%20%20'))).toBe('Busca: dune');
    expect(routeLabel('/search', q())).toBe('Busca');
    expect(routeLabel('/search', q(`q=${'x'.repeat(200)}`)).length).toBeLessThanOrEqual('Busca: '.length + 60);
  });

  test('rotas de detalhe ganham um nome genérico, sem vazar o id', () => {
    expect(routeLabel('/title/tmdb/tv/123', q())).toBe('Título');
    expect(routeLabel('/telegram/canal-secreto', q())).toBe('Canal do Telegram');
    expect(routeLabel('/watch/abc/1', q())).toBe('Assistir');
  });

  test('rota desconhecida e nomes do prototype não viram rótulo', () => {
    expect(routeLabel('/nao-existe', q())).toBe('Página não encontrada');
    expect(routeLabel('__proto__', q())).toBe('Página não encontrada');
    expect(routeLabel('constructor', q())).toBe('Página não encontrada');
  });
});
