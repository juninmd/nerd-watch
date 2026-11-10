import { describe, expect, test } from 'bun:test';
import { subtitlesRoutes } from '../src/server/routes/subtitles.ts';
import {
  alignSubtitleVtt,
  decideSync,
  mapTime,
  parseVttCues,
  retimeVtt,
  type TimedCue,
} from '../src/shared/subtitles/autosync.ts';
import { formatVttTime } from '../src/shared/subtitles/srt-vtt.ts';

/**
 * Alinhamento pelo tempo: a legenda do addon é comparada com a embutida no vídeo. Cada caso diz o que o
 * usuário veria: legenda certa sendo corrigida, legenda já certa intocada, e nenhuma correção quando não há consenso.
 */

/** Falas espaçadas de forma irregular (como diálogo real), para o atraso ter uma assinatura clara. */
const speechStarts = (n: number): number[] => {
  const out: number[] = [];
  let t = 5_000;
  for (let i = 0; i < n; i++) {
    out.push(t);
    t += 1_800 + ((i * 7919) % 4_100);
  }
  return out;
};

const cuesAt = (starts: number[], len = 1_500): TimedCue[] => starts.map((s) => ({ start: s, end: s + len }));

const toVtt = (cues: TimedCue[]): string =>
  `WEBVTT\n\n${cues.map((c, i) => `${formatVttTime(c.start)} --> ${formatVttTime(c.end)}\nfala ${i}`).join('\n\n')}\n`;

describe('decideSync: atraso constante', () => {
  test('legenda atrasada 2 s é corrigida para a referência', () => {
    const starts = speechStarts(60);
    const outcome = decideSync(cuesAt(starts.map((s) => s + 2_000)), cuesAt(starts));
    expect(outcome.applied).toBe(true);
    if (outcome.applied) {
      expect(Math.round(outcome.fit.offsetMs)).toBe(-2_000);
      expect(outcome.fit.scale).toBeCloseTo(1, 2);
      expect(outcome.fit.inliers).toBeGreaterThanOrEqual(55);
    }
  });

  test('legenda já alinhada não é mexida', () => {
    const starts = speechStarts(60);
    const outcome = decideSync(cuesAt(starts), cuesAt(starts));
    expect(outcome).toMatchObject({ applied: false, reason: 'already_in_sync' });
  });

  test('referência sem relação com a legenda não gera correção', () => {
    const outcome = decideSync(cuesAt(speechStarts(60)), cuesAt(speechStarts(60).map((s) => s * 3 + 17)));
    expect(outcome.applied).toBe(false);
  });

  test('legenda curta demais não tem consenso', () => {
    const starts = speechStarts(5);
    const outcome = decideSync(cuesAt(starts.map((s) => s + 1_000)), cuesAt(starts));
    expect(outcome).toMatchObject({ applied: false, reason: 'no_consensus' });
  });

  test('sem falas de um dos lados, não há o que comparar', () => {
    expect(decideSync([], cuesAt(speechStarts(10)))).toMatchObject({ applied: false, reason: 'empty' });
  });
});

describe('decideSync: deriva linear', () => {
  test('legenda com deriva de 2% (fps diferente) é reconstruída pela reta', () => {
    const starts = speechStarts(120);
    // Legenda em 25 fps contra referência em 24,5 fps: tempo da legenda = 0,98 · tempo da referência + 300 ms.
    const drifted = starts.map((s) => 0.98 * s + 300);
    const outcome = decideSync(cuesAt(drifted), cuesAt(starts));
    expect(outcome.applied).toBe(true);
    if (outcome.applied) {
      // Mapeamento: referência ≈ scale · legenda + offset. Inverso de 0,98·s+300.
      expect(outcome.fit.scale).toBeCloseTo(1 / 0.98, 2);
      expect(outcome.fit.inliers).toBeGreaterThan(110);
    }
  });

  test('deriva acima de 5% é recusada (suspeita demais para aplicar sem revisão)', () => {
    const starts = speechStarts(120);
    const outcome = decideSync(cuesAt(starts.map((s) => 1.2 * s)), cuesAt(starts));
    expect(outcome.applied).toBe(false);
  });
});

describe('retimeVtt e alignSubtitleVtt', () => {
  test('o texto das falas não muda; só as linhas de tempo andam', () => {
    const vtt = 'WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nOlá\n\n00:00:13.500 --> 00:00:15.000\nMundo\n';
    const out = retimeVtt(vtt, { scale: 1, offsetMs: -1_500, inliers: 0, total: 0 });
    expect(out).toBe('WEBVTT\n\n00:00:08.500 --> 00:00:10.500\nOlá\n\n00:00:12.000 --> 00:00:13.500\nMundo\n');
  });

  test('tempo nunca fica negativo', () => {
    expect(mapTime(500, { scale: 1, offsetMs: -2_000, inliers: 0, total: 0 })).toBe(0);
  });

  test('parseVttCues ignora linhas que não são de tempo', () => {
    expect(parseVttCues('WEBVTT\n\n00:01.000 --> 00:02.500\ntexto\n')).toEqual([{ start: 1_000, end: 2_500 }]);
  });

  test('sem consenso, devolve a legenda original byte a byte', () => {
    const sub = toVtt(cuesAt(speechStarts(30).map((s) => s + 1_000)));
    const ref = toVtt(cuesAt(speechStarts(3)));
    const { vtt, outcome } = alignSubtitleVtt(sub, ref);
    expect(outcome.applied).toBe(false);
    expect(vtt).toBe(sub);
  });
});

describe('POST /api/subtitles/autosync', () => {
  const post = (body: unknown) =>
    subtitlesRoutes.request('/autosync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('corrige uma legenda SRT atrasada usando a referência', async () => {
    const starts = speechStarts(40);
    const srt = (list: number[]) =>
      list.map((s, i) => `${i + 1}\n${formatVttTime(s).replace('.', ',')} --> ${formatVttTime(s + 1_000).replace('.', ',')}\nfala ${i}\n`).join('\n');
    const res = await post({ subtitle: srt(starts.map((s) => s + 3_000)), reference: srt(starts) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applied: boolean; offsetMs: number; vtt: string };
    expect(body.applied).toBe(true);
    expect(body.offsetMs).toBe(-3_000);
    expect(body.vtt.startsWith('WEBVTT\n\n00:00:05.000 --> 00:00:06.000')).toBe(true);
  });

  test('corpo sem as duas legendas é 400', async () => {
    const res = await post({ subtitle: 'x' });
    expect(res.status).toBe(400);
  });

  test('legenda sem linhas de tempo é 400 com mensagem fixa', async () => {
    const res = await post({ subtitle: 'não é legenda', reference: 'também não' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('legenda');
  });
});
