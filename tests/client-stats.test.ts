import { describe, expect, test } from 'bun:test';
import type { StatsSummary } from '../src/server/stats/summary.ts';
import { backlogView, formatDateBr, kpiCards, monthRows, yearOptions } from '../src/client/stats/model.ts';
import { shareCardModel } from '../src/client/stats/share-model.ts';
import { barListSvg, columnChartSvg, dataTable, niceMax, stackedColumnChartSvg } from '../src/client/stats/svg.ts';

/** Resumo sintético (formato de /api/stats) com números pequenos e conferíveis. */
const summary = (over: Partial<StatsSummary> = {}): StatsSummary => {
  const base: StatsSummary = {
    year: 2026,
    timezone: 'America/Sao_Paulo',
    hasData: true,
    firstYear: 2024,
    library: {
      byStatus: { want: 2, watching: 1, watched: 3, dropped: 0 },
      total: 6,
      watchTime: { hours: 12.5, knownTitles: 3, missingTitles: 1, episodesWithoutRuntime: 2 },
    },
    period: {
      finished: 4,
      rewatches: 1,
      progressEvents: 2,
      activeDays: 9,
      watchTime: { hours: 12.5, knownViewings: 4, missingViewings: 1 },
      months: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        finished: i === 2 ? 3 : 0,
        rewatches: i === 5 ? 1 : 0,
        progress: i === 2 ? 2 : 0,
        hours: i === 2 ? 5.7 : null,
      })),
      genres: { top: [{ name: 'Drama', titles: 2 }], untagged: 1 },
      ratings: { counts: [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0], average: 7.5, rated: 2, unrated: 2 },
      weekdays: [0, 1, 0, 2, 0, 1, 0],
      busiestWeekday: 3,
      longestStreak: { days: 4, start: '2026-03-01', end: '2026-03-04' },
    },
    backlog: { titles: 2, hours: 3, missingTitles: 0, hoursPerDay: 1, etaDays: 3, etaDate: '2026-11-02' },
  };
  return { ...base, ...over };
};

describe('kpiCards: números e dicas em pt-BR, vazio vira travessão e não zero', () => {
  test('valores de destaque do ano', () => {
    const cards = Object.fromEntries(kpiCards(summary()).map((k) => [k.id, k]));
    expect(cards.finished?.value).toBe('4');
    expect(cards.hours?.value).toBe('12,5 h');
    expect(cards.hours?.hint).toContain('1 exibição sem duração');
    expect(cards.rating?.value).toBe('7,5');
    expect(cards.genre?.value).toBe('Drama');
    expect(cards.weekday?.value).toBe('quarta-feira');
    expect(cards.days?.hint).toContain('4 dias');
  });

  test('sem nota, sem gênero e sem dia movimentado: travessão com dica, nunca zero', () => {
    const empty = summary({
      period: {
        ...summary().period,
        ratings: { counts: new Array(11).fill(0), average: null, rated: 0, unrated: 0 },
        genres: { top: [], untagged: 0 },
        busiestWeekday: null,
        longestStreak: null,
        activeDays: 0,
      },
    });
    const cards = Object.fromEntries(kpiCards(empty).map((k) => [k.id, k]));
    expect(cards.rating?.value).toBe('—');
    expect(cards.genre?.value).toBe('—');
    expect(cards.weekday?.value).toBe('—');
    expect(cards.days?.hint).toBe('nenhuma sequência ainda');
  });

  test('tempo sem nenhuma duração conhecida diz isso, não mostra 0 h como fato', () => {
    const none = summary({
      period: { ...summary().period, watchTime: { hours: 0, knownViewings: 0, missingViewings: 2 } },
    });
    expect(kpiCards(none).find((k) => k.id === 'hours')?.hint).toBe('2 exibições sem duração de fora');
  });
});

describe('backlogView: "terminar até" só com duração conhecida', () => {
  test('fila com data: frase de término e ritmo', () => {
    const v = backlogView(summary());
    expect(v.headline).toBe('Terminar até 02/11/2026');
    expect(v.detail).toBe('3 h na fila, no ritmo de 1 h por dia.');
  });

  test('fila sem duração conhecida: sem data inventada', () => {
    const v = backlogView(
      summary({ backlog: { titles: 2, hours: 0, missingTitles: 2, hoursPerDay: 1, etaDays: null, etaDate: null } }),
    );
    expect(v.headline).toBe('2 títulos na fila');
    expect(v.detail).toContain('Sem duração conhecida');
    expect(v.detail).toContain('2 sem duração');
  });

  test('fila vazia', () => {
    const v = backlogView(
      summary({ backlog: { titles: 0, hours: 0, missingTitles: 0, hoursPerDay: 1, etaDays: null, etaDate: null } }),
    );
    expect(v.headline).toBe('Fila vazia');
  });

  test('data sai como DD/MM/AAAA, sem passar pelo fuso do navegador', () => {
    expect(formatDateBr('2027-01-01')).toBe('01/01/2027');
  });
});

describe('monthRows e anos do seletor', () => {
  test('uma linha por mês, com dicas de conclusão e revisão separadas', () => {
    const rows = monthRows(summary());
    expect(rows).toHaveLength(12);
    expect(rows[2]?.finishedTip).toBe('março: 3 conclusões');
    expect(rows[5]?.rewatchTip).toBe('junho: 1 revisão');
    expect(rows[2]?.tip).toContain('5,7 h');
    expect(rows[0]?.hours).toBeNull();
  });

  test('seletor vai do primeiro ano com histórico até o ano atual, mais recente primeiro', () => {
    expect(yearOptions(2024, 2026)).toEqual([2026, 2025, 2024]);
    expect(yearOptions(null, 2026)).toEqual([2026]);
    expect(yearOptions(2030, 2026)).toEqual([2026]);
  });
});

describe('SVG: escala, marcas focáveis e texto escapado', () => {
  test('niceMax devolve 1, 2, 5 ou 10 vezes uma potência de dez', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(1200)).toBe(2000);
  });

  test('cada barra com valor é focável e carrega o tooltip; barra zero não é desenhada', () => {
    const svg = columnChartSvg(
      [
        { label: 'Jan', value: 0, tip: 'janeiro: nada' },
        { label: 'Fev', value: 2, tip: 'fevereiro: 2' },
      ],
      { label: 'Teste', color: '#3987e5' },
    );
    expect(svg.match(/tabindex="0"/g)).toHaveLength(1);
    expect(svg).toContain('data-tip="fevereiro: 2"');
    expect(svg).not.toContain('janeiro: nada');
  });

  test('texto do usuário (gênero) é escapado; nada de markup injetado', () => {
    const svg = barListSvg([{ label: '<img src=x onerror=1>', value: 1, tip: '<b>x</b>' }], {
      label: 'Gêneros',
      color: '#3987e5',
    });
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
    expect(svg).not.toContain('<b>x</b>');
  });

  test('empilhado: um segmento focável por série com valor', () => {
    const svg = stackedColumnChartSvg(
      [{ label: 'Mar', segments: [3, 0], tips: ['março: 3 conclusões', 'março: 0 revisões'] }],
      {
        label: 'Mês',
        colors: ['#3987e5', '#d95926'],
      },
    );
    expect(svg.match(/tabindex="0"/g)).toHaveLength(1);
  });

  test('tabela equivalente traz legenda, cabeçalhos e células escapadas', () => {
    const html = dataTable('Por mês', ['Mês', 'Conclusões'], [['Mar', '<3>']]);
    expect(html).toContain('<caption>Por mês</caption>');
    expect(html).toContain('&lt;3&gt;');
    expect(html).toContain('scope="col"');
  });
});

describe('cartão do ano: só agregados', () => {
  test('modelo traz título, meses e indicadores; não traz nomes de títulos nem datas de eventos', () => {
    const m = shareCardModel(summary());
    expect(m.headline).toBe('4 títulos concluídos em 2026');
    expect(m.months).toHaveLength(12);
    expect(m.months[2]).toBe(3);
    expect(m.tiles.map((t) => t.label)).toContain('Tempo assistido');
    const serialized = JSON.stringify(m);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test('sem conclusões no ano, o título do cartão diz isso', () => {
    const m = shareCardModel(summary({ period: { ...summary().period, finished: 0 } }));
    expect(m.headline).toBe('Ainda sem conclusões em 2026');
  });
});
