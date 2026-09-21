import { afterEach, describe, expect, test } from 'bun:test';
import { archiveSearchPublicDomain, pickSubtitleUrl } from '../src/server/providers/archive.ts';

describe('pickSubtitleUrl', () => {
  test('encontra .srt pelo format "SubRip"', () => {
    const url = pickSubtitleUrl('house_on_haunted_hill_ipod', [
      { name: 'house_on_haunted_hill.mp4', format: 'MPEG4' },
      { name: 'house_on_haunted_hill.asr.srt', format: 'SubRip' },
    ]);
    expect(url).toBe('https://archive.org/download/house_on_haunted_hill_ipod/house_on_haunted_hill.asr.srt');
  });

  test('encontra .vtt pela extensão quando o format não ajuda', () => {
    const url = pickSubtitleUrl('some_item', [{ name: 'legenda.vtt', format: 'Text' }]);
    expect(url).toBe('https://archive.org/download/some_item/legenda.vtt');
  });

  test('retorna null quando não há legenda entre os arquivos', () => {
    const url = pickSubtitleUrl('no_subs_item', [{ name: 'movie.mp4', format: 'MPEG4' }]);
    expect(url).toBeNull();
  });

  test('retorna null quando a lista de arquivos não veio', () => {
    expect(pickSubtitleUrl('missing_files', undefined)).toBeNull();
  });

  test('escapa nome de arquivo com caracteres especiais (regressão: URL podia quebrar/injetar atributo HTML)', () => {
    const url = pickSubtitleUrl('item_x', [{ name: 'legenda "estranha".srt', format: 'SubRip' }]);
    expect(url).toBe('https://archive.org/download/item_x/legenda%20%22estranha%22.srt');
  });
});

describe('archiveSearchPublicDomain', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sanitiza parênteses e operadores booleanos da busca (regressão: injeção furava o escopo domínio-público)', async () => {
    let capturedQuery = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedQuery = new URL(input as string | URL).searchParams.get('q') ?? '';
      return new Response(JSON.stringify({ response: { docs: [] } }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    await archiveSearchPublicDomain('injecao-teste-unico) OR (mediatype:texts');

    // parênteses, `:` e o "OR" maiúsculo do termo injetado viram texto literal minúsculo dentro do
    // grupo já escopado — não conseguem fechar o "(" nem introduzir uma cláusula OR/campo novos.
    expect(capturedQuery).toBe('collection:(feature_films) AND mediatype:(movies) AND (injecao teste unico or mediatype texts)');
  });
});
