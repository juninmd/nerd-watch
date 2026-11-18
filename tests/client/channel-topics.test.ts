import { describe, expect, test } from 'bun:test';
import { ALL, buildTopicTabs, GENERAL, groupByTab, itemsInTab, messageLink } from '../../src/client/channels/channel-topics.ts';

const v = (id: string, topicId?: string | null) => ({ id, topicId });

describe('buildTopicTabs', () => {
  test('canal sem fórum não tem abas', () => {
    expect(buildTopicTabs([v('1'), v('2', null)], [])).toEqual([]);
  });

  test('fórum: Geral primeiro, fixados antes dos demais, contagem por tópico e tópico vazio continua aparecendo', () => {
    const tabs = buildTopicTabs(
      [v('1'), v('2', '10'), v('3', '10'), v('4', '30')],
      [
        { topicId: '10', title: 'Anime', pinned: false },
        { topicId: '20', title: 'Avisos', pinned: true },
      ],
    );
    expect(tabs.map((t) => [t.id, t.title, t.count])).toEqual([
      [GENERAL, 'Geral', 1],
      ['20', 'Avisos', 0],
      ['10', 'Anime', 2],
      ['30', 'Tópico 30', 1],
    ]);
  });
});

describe('itemsInTab / groupByTab', () => {
  const items = [v('1'), v('2', '10'), v('3', '10')];
  test('filtra por aba; ALL devolve tudo; sem tópico cai em Geral', () => {
    expect(itemsInTab(items, ALL)).toHaveLength(3);
    expect(itemsInTab(items, GENERAL).map((i) => i.id)).toEqual(['1']);
    expect(itemsInTab(items, '10').map((i) => i.id)).toEqual(['2', '3']);
  });

  test('agrupa na ordem das abas e omite grupo vazio', () => {
    const tabs = buildTopicTabs(items, [{ topicId: '99', title: 'Vazio', pinned: false }]);
    expect(groupByTab(items, tabs).map((g) => [g.tab.id, g.items.length])).toEqual([[GENERAL, 1], ['10', 2]]);
  });
});

test('messageLink aceita @usuário e c/<id>', () => {
  expect(messageLink('@canal', '5')).toBe('https://t.me/canal/5');
  expect(messageLink('c/123', '5')).toBe('https://t.me/c/123/5');
});
