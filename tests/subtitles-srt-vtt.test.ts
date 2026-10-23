import { describe, expect, test } from 'bun:test';
import { formatVttTime, sanitizeCueLine, toWebVtt } from '../src/shared/subtitles/srt-vtt.ts';

/**
 * Conversão SRT/ASS -> WebVTT. Cada caso diz por que o comportamento importa: uma legenda ruim não
 * derruba o player, mas uma linha de tempo mal convertida faz a fala aparecer fora de hora.
 */

const cueTimes = (vtt: string): string[] => vtt.split('\n').filter((l) => l.includes(' --> '));

describe('toWebVtt: SRT basico', () => {
  test('troca vírgula por ponto e mantém o texto de cada cue', () => {
    const r = toWebVtt('1\n00:00:01,000 --> 00:00:03,500\nOlá\n\n2\n00:00:04,000 --> 00:00:05,000\nMundo\n');
    expect(r).toEqual({
      ok: true,
      cues: 2,
      vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nOlá\n\n00:00:04.000 --> 00:00:05.000\nMundo\n',
    });
  });

  test('BOM e CRLF não vazam para o VTT', () => {
    const r = toWebVtt('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nOi\r\n');
    expect(r.ok && r.vtt.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOi')).toBe(true);
  });

  test('quebra de linha só CR (Mac clássico) é tratada como quebra', () => {
    const r = toWebVtt(
      '1\r00:00:01,000 --> 00:00:02,000\rLinha um\rLinha dois\r\r2\r00:00:03,000 --> 00:00:04,000\rTerceira\r',
    );
    expect(r.ok && r.cues).toBe(2);
    expect(r.ok && r.vtt).toContain('Linha um\nLinha dois');
  });

  test('bloco sem linha em branco antes do próximo tempo ainda separa os cues', () => {
    const r = toWebVtt('00:00:01,000 --> 00:00:02,000\nA\n00:00:03,000 --> 00:00:04,000\nB');
    expect(r.ok && r.cues).toBe(2);
  });

  test('cues sobrepostos são mantidos (VTT permite)', () => {
    const r = toWebVtt('00:00:01,000 --> 00:00:05,000\nA\n\n00:00:02,000 --> 00:00:04,000\nB');
    expect(r.ok && cueTimes(r.vtt)).toEqual(['00:00:01.000 --> 00:00:05.000', '00:00:02.000 --> 00:00:04.000']);
  });

  test('arquivo que já é WebVTT passa pelo mesmo caminho', () => {
    const r = toWebVtt('WEBVTT\n\nNOTE texto de comentário\n\n00:00:01.000 --> 00:00:02.000\nOi\n');
    expect(r.ok && r.vtt).toContain('00:00:01.000 --> 00:00:02.000\nOi');
    expect(r.ok && r.vtt).not.toContain('NOTE');
  });
});

describe('toWebVtt: tempos', () => {
  test.each([
    ['1:02:03,004 --> 1:02:04,000', '01:02:03.004 --> 01:02:04.000'],
    ['00:00:01,5 --> 00:00:02,25', '00:00:01.500 --> 00:00:02.250'],
    ['100:00:00,000 --> 100:00:01,000', '100:00:00.000 --> 100:00:01.000'],
    ['123:45:06,789 --> 123:45:07,000', '123:45:06.789 --> 123:45:07.000'],
    // WebVTT aceita mm:ss.ttt; sem horas o cue não pode sumir.
    ['01:02.500 --> 01:04.000', '00:01:02.500 --> 00:01:04.000'],
  ])('linha %s vira %s', (line, expected) => {
    const r = toWebVtt(`${line}\nx\n`);
    expect(r.ok && cueTimes(r.vtt)).toEqual([expected]);
  });

  test('horas acima de 99 não truncam nem somem o cue', () => {
    const r = toWebVtt('100:00:00,000 --> 100:00:01,000\nlongo');
    expect(r.ok && r.vtt).toContain('100:00:00.000 --> 100:00:01.000');
  });

  test.each([
    ['minuto 61', '00:61:00,000 --> 00:62:00,000'],
    ['segundo 75', '00:00:75,000 --> 00:00:76,000'],
    ['sem milissegundos', '00:00:01 --> 00:00:02'],
    ['seta errada', '00:00:01,000 -> 00:00:02,000'],
    ['fim antes do início', '00:00:05,000 --> 00:00:01,000'],
    ['duração zero', '00:00:05,000 --> 00:00:05,000'],
  ])('tempo malformado é descartado (%s)', (_label, line) => {
    expect(toWebVtt(`${line}\nTexto\n`)).toEqual({ ok: false, reason: 'no_cues' });
  });

  test('um tempo ruim não derruba os cues bons ao redor', () => {
    const r = toWebVtt('00:61:00,000 --> 00:62:00,000\nruim\n\n1\n00:00:01,000 --> 00:00:02,000\nbom\n');
    expect(r.ok && r.cues).toBe(1);
    expect(r.ok && r.vtt).toContain('bom');
    expect(r.ok && r.vtt).not.toContain('ruim');
  });

  test('formatVttTime preserva milissegundos e cresce as horas sem limite', () => {
    expect(formatVttTime(0)).toBe('00:00:00.000');
    expect(formatVttTime(3_723_004)).toBe('01:02:03.004');
    expect(formatVttTime(360_000_000)).toBe('100:00:00.000');
  });
});

describe('toWebVtt: entrada vazia ou sem cue', () => {
  test.each([[''], ['   \n\n\t'], ['﻿'], ['\r\n\r\n']])('vazio (%j) é reprovado como empty', (input) => {
    expect(toWebVtt(input)).toEqual({ ok: false, reason: 'empty' });
  });

  test('só números de cue, sem tempo, é no_cues', () => {
    expect(toWebVtt('1\n\n2\n\n3\n')).toEqual({ ok: false, reason: 'no_cues' });
  });

  test('cue com texto vazio, ou só tag, é pulado (não vira tela em branco)', () => {
    expect(toWebVtt('00:00:01,000 --> 00:00:02,000\n\n00:00:03,000 --> 00:00:04,000\n<i></i>\n')).toEqual({
      ok: false,
      reason: 'no_cues',
    });
  });
});

describe('sanitização do texto', () => {
  test.each([
    ['<i>Oi</i> pessoal', 'Oi pessoal'],
    ['<font color="red">vermelho</font>', 'vermelho'],
    ['<c.yellow>amarelo</c>', 'amarelo'],
    ['A & B', 'A &amp; B'],
    ['já &amp; escapado', 'já &amp; escapado'],
    ['coração <3', 'coração &lt;3'],
    ['pare --> agora', 'pare --&gt; agora'],
    ['tab\there', 'tab\there'],
    ['nul\u0000e\u0007sino', 'nulesino'],
    ['  espaço nas pontas  ', 'espaço nas pontas'],
  ])('%j vira %j', (raw, expected) => {
    expect(sanitizeCueLine(raw)).toBe(expected);
  });

  test('texto de direita para a esquerda (árabe e hebraico) é preservado', () => {
    const r = toWebVtt('1\n00:00:01,000 --> 00:00:02,000\nمرحبا بالعالم\nשלום עולם\n');
    expect(r.ok && r.vtt).toContain('مرحبا بالعالم\nשלום עולם');
  });

  test('acentos e emoji de pt-BR passam sem alteração', () => {
    const r = toWebVtt('1\n00:00:01,000 --> 00:00:02,000\nAção, coração e vovó 🎬\n');
    expect(r.ok && r.vtt).toContain('Ação, coração e vovó 🎬');
  });
});

describe('toWebVtt: ASS/SSA basico', () => {
  const ass = [
    '[Script Info]',
    'Title: teste',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize',
    'Style: Default,Arial,20',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}Primeira, com vírgula',
    'Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,linha um\\Nlinha dois',
    'Dialogue: 0,0:00:06.00,0:00:05.00,Default,,0,0,0,,fim antes',
    'Comment: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,ignorado',
  ].join('\n');

  test('converte diálogos, remove overrides e mantém vírgulas do texto', () => {
    const r = toWebVtt(ass);
    expect(r.ok && r.cues).toBe(2);
    expect(r.ok && r.vtt).toContain('00:00:01.000 --> 00:00:03.500\nPrimeira, com vírgula');
    expect(r.ok && r.vtt).toContain('00:00:04.000 --> 00:00:05.000\nlinha um\nlinha dois');
    expect(r.ok && r.vtt).not.toContain('{');
  });
});

describe('toWebVtt: arquivo grande', () => {
  test('20 mil cues convertem inteiros e rápido', () => {
    const parts: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const s = i * 2;
      parts.push(`${i + 1}\n${formatSrt(s)} --> ${formatSrt(s + 1)}\nlinha ${i}\n`);
    }
    const r = toWebVtt(parts.join('\n'));
    expect(r.ok && r.cues).toBe(20_000);
  });
});

const formatSrt = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)},000`;
};
