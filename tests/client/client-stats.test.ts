import { describe, expect, test } from 'bun:test';
import type { StatsSummary } from '../../src/server/stats/summary.ts';
import { backlogView, formatDateBr, kpiCards, monthRows, yearOptions } from '../../src/client/stats/model.ts';
import { shareCardModel } from '../../src/client/stats/share-model.ts';
import {
  axisTicks,
  barList,
  columnChart,
  dataTable,
  heatmapSvg,
  niceMax,
  ringSvg,
  segmentedBar,
  stackedColumnChart,
} from '../../src/client/stats/charts.ts';
import { parseGoal } from '../../src/client/stats/goal.ts';
import { goalView, heatLayout, libraryParts, yearStrip } from '../../src/client/stats/insights.ts';

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
      days: [
        { date: '2026-03-01', events: 1 },
        { date: '2026-03-02', events: 4 },
      ],
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

describe('gráficos: escala, marcas focáveis e texto escapado', () => {
  test('niceMax devolve 1, 2, 5 ou 10 vezes uma potência de dez', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(1200)).toBe(2000);
  });

  test('cada barra com valor é focável e carrega o tooltip; barra zero não é desenhada', () => {
    const svg = columnChart(
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
    const svg = barList([{ label: '<img src=x onerror=1>', value: 1, tip: '<b>x</b>' }], {
      label: 'Gêneros',
      color: '#3987e5',
    });
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
    expect(svg).not.toContain('<b>x</b>');
  });

  test('empilhado: um segmento focável por série com valor', () => {
    const svg = stackedColumnChart(
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

describe('eixo de contagens: marcas sempre inteiras', () => {
  test('até 10 o teto é par (ou 1), para o meio não virar meio título', () => {
    expect(axisTicks(0)).toEqual([0, 1]);
    expect(axisTicks(1)).toEqual([0, 1]);
    expect(axisTicks(2)).toEqual([0, 1, 2]);
    expect(axisTicks(3)).toEqual([0, 2, 4]);
    expect(axisTicks(5)).toEqual([0, 3, 6]);
    expect(axisTicks(9)).toEqual([0, 5, 10]);
  });

  test('acima de 10 usa valores redondos, e todas as marcas seguem inteiras', () => {
    expect(axisTicks(11)).toEqual([0, 10, 20]);
    expect(axisTicks(37)).toEqual([0, 25, 50]);
    expect(axisTicks(180)).toEqual([0, 100, 200]);
    for (let v = 0; v <= 2500; v++) for (const t of axisTicks(v)) expect(Number.isInteger(t)).toBe(true);
  });

  test('só a coluna mais alta leva o número na ponta', () => {
    const html = columnChart(
      [
        { label: 'A', value: 2, tip: 'a' },
        { label: 'B', value: 7, tip: 'b' },
        { label: 'C', value: 7, tip: 'c' },
      ],
      { label: 'Teste', color: '#3987e5' },
    );
    expect(html.match(/class="chart-val"/g)).toHaveLength(1);
    expect(html).toContain('<span class="chart-val" aria-hidden="true">7</span>');
  });

  test('empilhado: só o segmento de cima leva a ponta arredondada', () => {
    const html = stackedColumnChart([{ label: 'Mar', segments: [3, 2], tips: ['c', 'r'] }], { label: 'Mês', colors: ['#3987e5', '#d95926'] });
    expect(html.match(/chart-bar is-cap/g)).toHaveLength(1);
    expect(html.indexOf('is-cap')).toBeGreaterThan(html.indexOf('background:#3987e5'));
  });
});

describe('mapa de atividade', () => {
  test('um quadrado por dia do ano, com a semana abrindo no domingo', () => {
    const layout = heatLayout(2026, summary().period.days);
    expect(layout.cells).toHaveLength(365);
    // 1º de janeiro de 2026 é quinta-feira (linha 4), na primeira coluna.
    expect(layout.cells[0]).toMatchObject({ date: '2026-01-01', col: 0, row: 4, level: 0 });
    expect(layout.cells[364]).toMatchObject({ date: '2026-12-31', row: 4 });
    expect(layout.weeks).toBe(53);
    expect(heatLayout(2024, []).cells).toHaveLength(366);
  });

  test('nível em quartos do dia mais movimentado; dia sem evento fica no nível 0', () => {
    const layout = heatLayout(2026, summary().period.days);
    const byDate = Object.fromEntries(layout.cells.map((c) => [c.date, c]));
    expect(byDate['2026-03-01']?.level).toBe(1);
    expect(byDate['2026-03-02']?.level).toBe(4);
    expect(byDate['2026-03-02']?.tip).toBe('2 de março: 4 eventos');
    expect(byDate['2026-03-01']?.tip).toBe('1 de março: 1 evento');
    expect(byDate['2026-03-03']?.level).toBe(0);
  });

  test('um rótulo por mês, na coluna da semana em que ele começa', () => {
    const { months } = heatLayout(2026, []);
    expect(months.map((m) => m.label)).toEqual(['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']);
    expect(months[0]?.col).toBe(0);
    expect(months[1]?.col).toBe(5);
  });

  test('SVG: só os dias ativos são focáveis e carregam tooltip', () => {
    const svg = heatmapSvg(heatLayout(2026, summary().period.days), { label: 'Atividade', weekdays: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] });
    expect(svg.match(/tabindex="0"/g)).toHaveLength(2);
    expect(svg.match(/<rect /g)).toHaveLength(365);
    expect(svg).toContain('data-tip="2 de março: 4 eventos"');
  });
});

describe('composição da biblioteca', () => {
  test('partes na ordem fixa, com a fatia em porcentagem no tooltip', () => {
    const parts = libraryParts(summary());
    expect(parts.map((p) => p.label)).toEqual(['Assistido', 'Assistindo', 'Quero ver', 'Abandonado']);
    expect(parts[0]?.tip).toBe('Assistido: 3 títulos (50%)');
    expect(parts[1]?.tip).toBe('Assistindo: 1 título (17%)');
  });

  test('barra: parte zerada não é desenhada nem entra na legenda; fatia pequena fica sem texto', () => {
    const html = segmentedBar(
      [
        { label: 'A', value: 9, color: '#199e70', tip: 'A: 9' },
        { label: 'B', value: 0, color: '#c98500', tip: 'B: 0' },
        { label: '<b>C</b>', value: 1, color: '#3987e5', tip: 'C: 1' },
      ],
      { label: 'Teste' },
    );
    expect(html.match(/class="seg"/g)).toHaveLength(2);
    expect(html).toContain('>90%</div>');
    expect(html).not.toContain('>10%</div>');
    expect(html).not.toContain('B: 0');
    expect(html).not.toContain('<b>C</b>');
    expect(segmentedBar([{ label: 'A', value: 0, color: '#199e70', tip: 'A' }], { label: 'Vazio' })).toBe('');
  });
});

describe('meta do ano', () => {
  test('no ano corrente compara com o esperado até hoje', () => {
    // 1º de julho de 2026 é o dia 182 de 365: de uma meta de 24, o esperado é 11.
    const onPace = goalView(12, 24, 2026, '2026-07-01');
    expect(onPace.headline).toBe('12 de 24');
    expect(onPace.progress).toBe(0.5);
    expect(onPace.detail).toBe('No ritmo: faltam 12, cerca de 2 por mês até dezembro.');
    const behind = goalView(4, 24, 2026, '2026-07-01');
    expect(behind.detail).toBe('Atrás do ritmo (o esperado até hoje era 11): faltam 20, cerca de 3,3 por mês até dezembro.');
  });

  test('meta batida, com e sem sobra', () => {
    expect(goalView(24, 24, 2026, '2026-07-01').detail).toBe('Meta batida.');
    const over = goalView(30, 24, 2026, '2026-07-01');
    expect(over.detail).toBe('Meta batida, com 6 além dela.');
    expect(over.progress).toBe(1.25);
  });

  test('ano passado só diz quanto faltou; ano futuro não cobra ritmo', () => {
    expect(goalView(20, 24, 2025, '2026-07-01').detail).toBe('Faltaram 4 para a meta de 2025.');
    expect(goalView(23, 24, 2025, '2026-07-01').detail).toBe('Faltou 1 para a meta de 2025.');
    expect(goalView(0, 24, 2027, '2026-07-01').detail).toBe('Esse ano ainda não começou.');
  });

  test('campo e armazenamento aceitam só inteiro de 1 a 999', () => {
    expect(parseGoal('24')).toBe(24);
    expect(parseGoal(' 7 ')).toBe(7);
    for (const bad of ['', '0', '1000', '-3', '2.5', 'abc', '1e2', null, undefined]) expect(parseGoal(bad)).toBeNull();
  });

  test('anel: o arco é limitado entre vazio e cheio', () => {
    expect(ringSvg(0.5)).toContain('--gap:163.36');
    expect(ringSvg(3)).toContain('--gap:0.00');
    expect(ringSvg(-1)).not.toContain('ring-fill');
    expect(ringSvg(0)).toContain('ring-track');
  });
});

describe('faixa "Seu ano" da tela inicial', () => {
  test('três números, os meses para o mini gráfico e uma frase só para leitor de tela', () => {
    const strip = yearStrip(summary(), 5);
    expect(strip?.items.map((i) => `${i.value} ${i.label}`)).toEqual(['4 títulos concluídos', '12,5 h assistidas', '9 dias ativos']);
    expect(strip?.months).toHaveLength(12);
    expect(strip?.months[2]).toBe(3);
    expect(strip?.months[5]).toBe(1);
    expect(strip?.currentMonth).toBe(5);
    expect(strip?.label).toBe('Seu ano em 2026: 4 títulos concluídos, 12,5 h assistidas, 9 dias ativos. Abrir estatísticas.');
  });

  test('sem nada no ano a faixa não aparece', () => {
    const empty = summary({ period: { ...summary().period, finished: 0, rewatches: 0, activeDays: 0 } });
    expect(yearStrip(empty, 0)).toBeNull();
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
