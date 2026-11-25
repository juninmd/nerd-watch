import { describe, expect, test } from 'bun:test';
import { buildChannelList } from '../../src/client/channels/channel-list.ts';
import { ALL, buildTopicTabs } from '../../src/client/channels/channel-topics.ts';

const item = (messageId: string, caption: string, topicId: string | null, postedAt: string) => ({
  messageId,
  caption,
  topicId,
  postedAt,
});
const items = [item('1', 'Aula um', null, '2026-01-01'), item('2', 'Aula dois', '7', '2026-01-02'), item('3', 'Extra', '7', '2026-01-03')];
const tabs = buildTopicTabs(items, [{ topicId: '7', title: 'Curso', pinned: false }]);

describe('buildChannelList', () => {
  test('em "Todos" agrupa por subgrupo e põe o cabeçalho só no primeiro vídeo de cada grupo', () => {
    const { matches, headings } = buildChannelList(items, 'oldest', ALL, tabs, '');
    expect(matches.map((i) => i.messageId)).toEqual(['1', '2', '3']);
    expect([...headings]).toEqual([
      ['1', 'Geral · 1'],
      ['2', 'Curso · 2'],
    ]);
  });

  test('aba de tópico mostra só aquele tópico, sem cabeçalhos', () => {
    const { matches, headings } = buildChannelList(items, 'newest', '7', tabs, '');
    expect(matches.map((i) => i.messageId)).toEqual(['3', '2']);
    expect(headings.size).toBe(0);
  });

  test('a busca filtra depois da ordem: "Reproduzir tudo" toca exatamente o que está na tela', () => {
    expect(buildChannelList(items, 'newest', ALL, [], 'aula').matches.map((i) => i.messageId)).toEqual(['2', '1']);
  });
});
