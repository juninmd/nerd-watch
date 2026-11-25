import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StreamGroup } from '../../src/client/addons/stream-group.tsx';
import type { AddonStreamGroup } from '../../src/client/addons/stream-lookup.ts';
import { STREAM_PREVIEW } from '../../src/client/addons/stream-preview.ts';

const group = (count: number, error: string | null = null): AddonStreamGroup => ({
  addonId: 'a',
  name: 'Addon',
  host: 'addon.example',
  type: 'movie',
  contentId: 'tt1',
  error,
  streams: Array.from({ length: count }, (_, index) => ({
    index,
    kind: 'url' as const,
    title: `Fonte ${index}`,
    url: `https://cdn.example/${index}.mp4`,
    infoHash: null,
    fileIdx: null,
    filename: null,
  })),
});

const render = (g: AddonStreamGroup, expanded: boolean, playingIndex: number | null = null) =>
  renderToStaticMarkup(<StreamGroup group={g} expanded={expanded} onToggle={() => undefined} onPlay={() => undefined} playingIndex={playingIndex} />);

const cards = (html: string) => html.match(/<li class="stream-card/g)?.length ?? 0;

describe('StreamGroup', () => {
  test('lista longa mostra só a prévia e oferece abrir o resto, para 500 cartões não travarem a tela', () => {
    const html = render(group(20), false);
    expect(cards(html)).toBe(STREAM_PREVIEW);
    expect(html).toContain('mostrar todos (20)');
  });

  test('lista aberta mostra tudo e oferece fechar', () => {
    const html = render(group(20), true);
    expect(cards(html)).toBe(20);
    expect(html).toContain('mostrar menos');
  });

  test('erro do addon aparece no lugar da lista', () => {
    const html = render(group(0, 'timeout'), false);
    expect(html).toContain('erro: timeout');
    expect(cards(html)).toBe(0);
  });

  test('marca só o cartão que está tocando', () => {
    const html = render(group(3), false, 1);
    expect(html.match(/is-playing/g)?.length).toBe(1);
  });
});
