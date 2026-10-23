import { describe, expect, test } from 'bun:test';
import { backlogEstimate, libraryTotals, sumDurations } from '../src/server/stats/totals.ts';

describe('sumDurations: o total diz quanto ficou de fora', () => {
  test('soma só o conhecido e conta títulos e episódios sem duração', () => {
    expect(
      sumDurations([
        { minutes: 60, episodesWithoutRuntime: 0 },
        { minutes: null, episodesWithoutRuntime: 0 },
        { minutes: 30, episodesWithoutRuntime: 3 },
      ]),
    ).toEqual({
      hours: 1.5,
      knownTitles: 2,
      missingTitles: 1,
      episodesWithoutRuntime: 3,
    });
  });

  test('lista vazia: zero horas e nada faltando', () => {
    expect(sumDurations([])).toEqual({ hours: 0, knownTitles: 0, missingTitles: 0, episodesWithoutRuntime: 0 });
  });
});

describe('libraryTotals', () => {
  test('status ausente conta como zero; total soma todos os status', () => {
    const t = libraryTotals({ want: 2, watched: 3 }, []);
    expect(t.byStatus).toEqual({ want: 2, watching: 0, watched: 3, dropped: 0 });
    expect(t.total).toBe(5);
  });
});

describe('backlogEstimate: "quero ver" → "terminar até" no ritmo dado', () => {
  const today = '2026-10-22';

  test('arredonda os dias para cima e soma a partir de hoje', () => {
    // 90 min a 1 h/dia = 1,5 dia → 2 dias
    const b = backlogEstimate(
      [
        { minutes: 60, episodesWithoutRuntime: 0 },
        { minutes: 30, episodesWithoutRuntime: 0 },
      ],
      1,
      today,
    );
    expect(b).toEqual({ titles: 2, hours: 1.5, missingTitles: 0, hoursPerDay: 1, etaDays: 2, etaDate: '2026-10-24' });
  });

  test('ritmo maior encurta; ritmo de 15 min por dia alonga', () => {
    const wanted = [{ minutes: 90, episodesWithoutRuntime: 0 }];
    expect(backlogEstimate(wanted, 2, today).etaDate).toBe('2026-10-23');
    expect(backlogEstimate(wanted, 0.25, today).etaDays).toBe(6);
  });

  test('virada de mês e de ano na data prevista', () => {
    expect(backlogEstimate([{ minutes: 600, episodesWithoutRuntime: 0 }], 1, '2026-12-30').etaDate).toBe('2027-01-09');
  });

  test('fila sem nenhuma duração conhecida não tem data: não inventa um término', () => {
    const b = backlogEstimate(
      [
        { minutes: null, episodesWithoutRuntime: 0 },
        { minutes: null, episodesWithoutRuntime: 4 },
      ],
      1,
      today,
    );
    expect(b).toMatchObject({ titles: 2, hours: 0, missingTitles: 2, etaDate: null, etaDays: null });
  });

  test('fila vazia: sem data e sem títulos', () => {
    expect(backlogEstimate([], 1, today)).toEqual({
      titles: 0,
      hours: 0,
      missingTitles: 0,
      hoursPerDay: 1,
      etaDays: null,
      etaDate: null,
    });
  });

  test('parte conhecida entra na estimativa; o que falta é contado à parte', () => {
    const b = backlogEstimate(
      [
        { minutes: 120, episodesWithoutRuntime: 0 },
        { minutes: null, episodesWithoutRuntime: 2 },
      ],
      1,
      today,
    );
    expect(b).toMatchObject({ titles: 2, hours: 2, missingTitles: 1, etaDays: 2 });
  });
});
