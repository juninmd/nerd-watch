import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { liveArgs, normalizeStart, parseOrdinal, probeArgs, remuxArgs, subtitleArgs } from '../src/server/media/args.ts';

/** Caminho absoluto de exemplo, do jeito que o servidor entrega (realpath). */
const ABS = path.resolve('/media/series/ep01.mkv');
const OUT = path.resolve('/cache/abc.mp4.part');

/**
 * Propriedade de segurança: nenhum texto vindo da requisição pode virar flag, filtro ou caminho. Os builders só
 * aceitam número, enum e caminho absoluto. Aqui cada entrada hostil tem que ser recusada ou ficar presa a um valor.
 */
const HOSTILE = ['-f', '--', '; rm -rf /', '$(id)', 'http://169.254.169.254/x', 'concat:a|b', 'file:../../secret', '-i', '\0'];

describe('argumentos do ffmpeg: fixos, sem entrada do usuário', () => {
  test('o arquivo de entrada vem logo após -i e é o único caminho de entrada', () => {
    const args = liveArgs({ input: ABS, startSeconds: 0, videoStreamIndex: 0, audioOrdinal: 0, deinterlace: false });
    expect(args[args.indexOf('-i') + 1]).toBe(ABS);
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
  });

  test('protocol_whitelist fica restrito a arquivo local em toda montagem', () => {
    for (const args of [
      probeArgs(ABS),
      remuxArgs({ input: ABS, output: OUT, videoStreamIndex: 0, audioOrdinal: 0, audio: 'copy' }),
      liveArgs({ input: ABS, startSeconds: 1, videoStreamIndex: 0, audioOrdinal: null, deinterlace: true }),
      subtitleArgs(ABS, 0),
    ]) {
      const i = args.indexOf('-protocol_whitelist');
      expect(args[i + 1]).toBe('file');
    }
  });

  test('caminho relativo, vazio ou começando com "-" é recusado (nunca vira flag)', () => {
    for (const bad of ['relative/ep.mkv', '', '-f', '--help']) {
      expect(() => probeArgs(bad)).toThrow();
      expect(() => liveArgs({ input: bad, startSeconds: 0, videoStreamIndex: 0, audioOrdinal: null, deinterlace: false })).toThrow();
    }
  });

  test('saída de remux precisa ser um .part absoluto gerado pelo servidor', () => {
    const base = { input: ABS, videoStreamIndex: 0, audioOrdinal: 0, audio: 'copy' as const };
    expect(() => remuxArgs({ ...base, output: 'saida.mp4' })).toThrow();
    expect(() => remuxArgs({ ...base, output: path.resolve('/cache/abc.mp4') })).toThrow();
  });

  test('índices e posição não aceitam texto: viram número validado ou erro', () => {
    expect(() => liveArgs({ input: ABS, startSeconds: Number.NaN, videoStreamIndex: 0, audioOrdinal: 0, deinterlace: false })).toThrow();
    expect(() => liveArgs({ input: ABS, startSeconds: -1, videoStreamIndex: 0, audioOrdinal: 0, deinterlace: false })).toThrow();
    expect(() => liveArgs({ input: ABS, startSeconds: 0, videoStreamIndex: 0, audioOrdinal: 1.5, deinterlace: false })).toThrow();
    expect(() => subtitleArgs(ABS, 1000)).toThrow();
  });

  test('entradas hostis passadas como caminho nunca aparecem como flag', () => {
    for (const hostile of HOSTILE) {
      const attempts = [
        () => probeArgs(hostile),
        () => liveArgs({ input: hostile, startSeconds: 0, videoStreamIndex: 0, audioOrdinal: 0, deinterlace: false }),
        () => subtitleArgs(hostile, 0),
      ];
      for (const attempt of attempts) {
        try {
          const args = attempt();
          // Se a montagem aceitou, o valor só pode estar logo após -i, nunca como opção nova.
          expect(args[args.indexOf('-i') + 1]).toBe(hostile);
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }
      }
    }
  });

  test('a flag de legenda e o formato de saída são fixos', () => {
    const args = subtitleArgs(ABS, 2);
    expect(args).toContain('webvtt');
    expect(args[args.indexOf('-map') + 1]).toBe('0:s:2');
    expect(args.at(-1)).toBe('pipe:1');
  });
});

describe('montagem: formas esperadas', () => {
  test('remux copia o vídeo, copia o áudio quando permitido e grava faststart no .part', () => {
    const args = remuxArgs({ input: ABS, output: OUT, videoStreamIndex: 3, audioOrdinal: 1, audio: 'copy' });
    expect(args).toEqual(expect.arrayContaining(['-map', '0:3', '0:a:1', '-c:v', 'copy', '-c:a', 'copy', '+faststart']));
    expect(args.at(-1)).toBe(OUT);
  });

  test('remux com áudio que precisa de conversão usa AAC estéreo', () => {
    const args = remuxArgs({ input: ABS, output: OUT, videoStreamIndex: 0, audioOrdinal: 0, audio: 'aac' });
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'aac', '-ac', '2']));
  });

  test('remux sem áudio não mapeia trilha nenhuma', () => {
    const args = remuxArgs({ input: ABS, output: OUT, videoStreamIndex: 0, audioOrdinal: null, audio: 'none' });
    expect(args.filter((a) => a === '-map')).toHaveLength(1);
  });

  test('transcodificação: H.264 yuv420p, teto de altura, sem legenda, fMP4 no stdout', () => {
    const args = liveArgs({ input: ABS, startSeconds: 12.5, videoStreamIndex: 0, audioOrdinal: 0, deinterlace: false });
    expect(args[args.indexOf('-ss') + 1]).toBe('12.500');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-sn', '-movflags']));
    expect(args[args.indexOf('-vf') + 1]).toBe("scale=-2:'min(1080,ih)'");
    expect(args.at(-1)).toBe('pipe:1');
  });

  test('desentrelaçamento entra antes do teto de altura, só quando pedido', () => {
    const args = liveArgs({ input: ABS, startSeconds: 0, videoStreamIndex: 0, audioOrdinal: null, deinterlace: true });
    expect(args[args.indexOf('-vf') + 1]).toMatch(/^yadif=.*,scale=/);
    expect(args).toContain('-an');
  });
});

describe('parseOrdinal e normalizeStart', () => {
  test('ordinal aceita só um a dois dígitos', () => {
    expect(parseOrdinal('0')).toBe(0);
    expect(parseOrdinal('12')).toBe(12);
    for (const bad of ['', '-1', '1.5', '123', 'abc', '1;2', undefined]) expect(parseOrdinal(bad)).toBeUndefined();
  });

  test('posição: vazia, negativa ou NaN vira 0; decimal passa', () => {
    expect(normalizeStart(undefined, 100)).toBe(0);
    expect(normalizeStart('', 100)).toBe(0);
    expect(normalizeStart('-5', 100)).toBe(0);
    expect(normalizeStart('abc', 100)).toBe(0);
    expect(normalizeStart('42.5', 100)).toBe(42.5);
  });

  test('posição além do fim é recortada meio segundo antes do fim (nunca reabre o início)', () => {
    expect(normalizeStart('500', 100)).toBe(99.5);
    expect(normalizeStart('100', 100)).toBe(99.5);
  });

  test('sem duração conhecida a posição é aceita como veio', () => {
    expect(normalizeStart('500', null)).toBe(500);
  });

  test('duração de 0 ou menos num arquivo curto não gera posição negativa', () => {
    expect(normalizeStart('3', 0.2)).toBe(0);
  });
});
