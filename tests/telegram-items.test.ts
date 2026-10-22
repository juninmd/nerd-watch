import { describe, expect, test } from 'bun:test';
import { itemDescription, itemTitle, orderItems, pickNextChannel, toDockItem, watchPath } from '../src/client/telegram-items.ts';

describe('itemTitle / itemDescription', () => {
  test('a primeira linha não vazia é o título e o resto vira descrição, mantendo as quebras', () => {
    const item = { messageId: '7', caption: '\nEpisódio 3 — final\n\nlinha dois\nlinha três' };
    expect(itemTitle(item)).toBe('Episódio 3 — final');
    expect(itemDescription(item)).toBe('linha dois\nlinha três');
  });

  test('sem legenda usa o id da mensagem; legenda de uma linha não tem descrição', () => {
    expect(itemTitle({ messageId: '9', caption: null })).toBe('Vídeo — mensagem 9');
    expect(itemDescription({ caption: 'só o título' })).toBeNull();
    expect(itemDescription({ caption: null })).toBeNull();
  });

  test('corta títulos longos no limite', () => {
    expect(itemTitle({ messageId: '1', caption: 'x'.repeat(200) }, 10)).toHaveLength(10);
  });
});

describe('toDockItem / watchPath', () => {
  test('monta o item do player com chave estável por canal e mensagem', () => {
    const item = toDockItem({ titleId: 'c1', title: 'Canal' }, { messageId: '5', caption: 'Oi', durationSeconds: 30, thumbnailUrl: '/t', postedAt: null });
    expect(item).toMatchObject({ key: 'c1:5', title: 'Oi', subtitle: 'Canal', channelId: 'c1', messageId: '5', poster: '/t', durationSeconds: 30 });
    expect(item.src).toContain('/api/telegram/channels/c1/items/5/play');
    expect(watchPath('c1', '5')).toBe('/watch/c1/5');
  });
});

describe('pickNextChannel', () => {
  const ch = (titleId: string, itemCount: number) => ({ titleId, itemCount });

  test('sugere o seguinte da lista e volta ao início depois do último', () => {
    const list = [ch('a', 3), ch('b', 2), ch('c', 1)];
    expect(pickNextChannel(list, 'a')?.titleId).toBe('b');
    expect(pickNextChannel(list, 'c')?.titleId).toBe('a');
  });

  test('pula canais sem vídeo', () => {
    expect(pickNextChannel([ch('a', 3), ch('vazio', 0), ch('c', 1)], 'a')?.titleId).toBe('c');
  });

  test('sem outro canal com vídeos não sugere nada', () => {
    expect(pickNextChannel([ch('a', 3)], 'a')).toBeNull();
    expect(pickNextChannel([ch('a', 3), ch('b', 0)], 'a')).toBeNull();
    expect(pickNextChannel([], 'a')).toBeNull();
  });

  test('canal atual fora da lista começa do primeiro com vídeos', () => {
    expect(pickNextChannel([ch('vazio', 0), ch('a', 1), ch('b', 1)], 'x')?.titleId).toBe('a');
  });
});

describe('orderItems', () => {
  const items = [{ messageId: '20' }, { messageId: '3' }, { messageId: '100' }];

  test('mais recente primeiro compara os ids como números, não como texto', () => {
    expect(orderItems(items, 'newest').map((i) => i.messageId)).toEqual(['100', '20', '3']);
  });

  test('mais antigo primeiro é o inverso', () => {
    expect(orderItems(items, 'oldest').map((i) => i.messageId)).toEqual(['3', '20', '100']);
  });

  test('não muda a lista original', () => {
    orderItems(items, 'oldest');
    expect(items.map((i) => i.messageId)).toEqual(['20', '3', '100']);
  });
});
