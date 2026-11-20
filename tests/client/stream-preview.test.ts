import { describe, expect, test } from 'bun:test';
import { ADDON_STREAM_CAP, atAddonCap, previewStreams, STREAM_PREVIEW } from '../../src/client/addons/stream-preview.ts';

/**
 * Lista longa de streams: o addon de torrent chega a 500 itens (teto dele). Mostrar os primeiros e
 * abrir o resto sob demanda é o que evita 500 cartões no DOM de uma vez.
 */
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i }));

describe('previewStreams', () => {
  test('lista curta aparece inteira, sem botão', () => {
    expect(previewStreams(items(3), false)).toEqual({ visible: items(3), hidden: 0, total: 3 });
    expect(previewStreams([], false)).toEqual({ visible: [], hidden: 0, total: 0 });
  });

  test('lista longa mostra só os primeiros e informa quantos ficaram', () => {
    const preview = previewStreams(items(50), false);
    expect(preview.visible).toHaveLength(STREAM_PREVIEW);
    expect(preview.hidden).toBe(50 - STREAM_PREVIEW);
    expect(preview.total).toBe(50);
  });

  test('expandido devolve tudo e nenhum escondido', () => {
    const preview = previewStreams(items(50), true);
    expect(preview.visible).toHaveLength(50);
    expect(preview.hidden).toBe(0);
  });

  test('limite explícito é respeitado e exatamente no limite não esconde nada', () => {
    expect(previewStreams(items(10), false, 2).visible).toHaveLength(2);
    expect(previewStreams(items(2), false, 2).hidden).toBe(0);
  });
});

describe('atAddonCap', () => {
  test('avisa quando a lista veio no teto do addon', () => {
    expect(atAddonCap(ADDON_STREAM_CAP)).toBe(true);
    expect(atAddonCap(ADDON_STREAM_CAP + 1)).toBe(true);
    expect(atAddonCap(ADDON_STREAM_CAP - 1)).toBe(false);
    expect(atAddonCap(0)).toBe(false);
  });
});
