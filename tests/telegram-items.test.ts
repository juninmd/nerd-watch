import { describe, expect, test } from 'bun:test';
import { itemDescription, itemTitle, toDockItem, watchPath } from '../src/client/telegram-items.ts';

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
