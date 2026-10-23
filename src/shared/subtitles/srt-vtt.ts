/**
 * Converte legenda de texto (SRT, e o básico de ASS/SSA) para WebVTT. Puro: sem DOM e sem rede, para
 * servir ao servidor (proxy das fontes) e ao cliente (arquivo escolhido pelo usuário).
 *
 * Tags de HTML e de override do ASS são removidas, não preservadas: a legenda vira só texto.
 */

export type VttConversion = { ok: true; vtt: string; cues: number } | { ok: false; reason: 'empty' | 'no_cues' };

interface Cue {
  start: number;
  end: number;
  text: string[];
}

const SRT_TIME = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
const ASS_TIME = /^\s*(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,3})\s*$/;
const ASS_SECTION = /^\s*\[(script info|v4\+? styles|events)\]/im;

/** Fração de segundo: "5" vira 500 ms (SRT e ASS, em centésimos, tratam o resto como casas decimais). */
const millis = (fraction: string): number => Number(fraction.padEnd(3, '0'));

/** Tempo em milissegundos, ou null quando o campo não é um tempo válido (minuto ou segundo acima de 59). */
const toMillis = (h: string, m: string, s: string, frac: string): number | null => {
  const minutes = Number(m);
  const seconds = Number(s);
  if (minutes > 59 || seconds > 59) return null;
  return ((Number(h) * 60 + minutes) * 60 + seconds) * 1000 + millis(frac);
};

/** Formato WebVTT: horas com pelo menos dois dígitos (acima de 99 h, a conta cresce sem truncar). */
export const formatVttTime = (totalMs: number): string => {
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, size: number) => String(n).padStart(size, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
};

/** Controle C0 (exceto tab) e DEL: nunca faz parte de legenda, e o WebVTT rejeita. */
const isControl = (ch: string): boolean => {
  const code = ch.charCodeAt(0);
  return (code < 0x20 && code !== 0x09) || code === 0x7f;
};

/** Remove controles invisíveis (exceto tab), tags HTML e overrides do ASS; escapa o que o WebVTT lê como markup. */
export const sanitizeCueLine = (line: string): string => {
  const stripped = line
    .split('')
    .filter((ch) => !isControl(ch))
    .join('')
    .replace(/<[^>\n]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '');
  return stripped
    .replace(/&(?!(?:amp|lt|gt|lrm|rlm|nbsp|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^\s+|\s+$/g, '');
};

/** SRT e VTT: blocos com linha de tempo; o texto vai até a linha em branco ou até o próximo tempo. */
const parseTimed = (lines: string[]): Cue[] => {
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = SRT_TIME.exec(lines[i] ?? '');
    if (!match) continue;
    const start = toMillis(match[1] ?? '0', match[2] ?? '', match[3] ?? '', match[4] ?? '');
    const end = toMillis(match[5] ?? '0', match[6] ?? '', match[7] ?? '', match[8] ?? '');
    const text: string[] = [];
    let j = i + 1;
    while (j < lines.length && (lines[j] ?? '').trim() !== '' && !SRT_TIME.test(lines[j] ?? '')) {
      text.push(lines[j] ?? '');
      j++;
    }
    i = j - 1;
    if (start === null || end === null || end <= start) continue;
    cues.push({ start, end, text });
  }
  return cues;
};

/** ASS/SSA: a linha "Format:" da seção de eventos diz em que coluna estão Start, End e Text. */
const parseAss = (lines: string[]): Cue[] => {
  const cues: Cue[] = [];
  let inEvents = false;
  let columns: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) {
      columns = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((c) => c.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue:/i.test(line) || columns.length === 0) continue;
    const fields = line.slice(line.indexOf(':') + 1).split(',');
    const at = (name: string) => fields[columns.indexOf(name)]?.trim() ?? '';
    const startMatch = ASS_TIME.exec(at('start'));
    const endMatch = ASS_TIME.exec(at('end'));
    if (!startMatch || !endMatch) continue;
    const start = toMillis(startMatch[1] ?? '', startMatch[2] ?? '', startMatch[3] ?? '', startMatch[4] ?? '');
    const end = toMillis(endMatch[1] ?? '', endMatch[2] ?? '', endMatch[3] ?? '', endMatch[4] ?? '');
    // O texto é a última coluna e pode conter vírgulas: junta o que sobrou depois da coluna dele.
    const textIndex = columns.indexOf('text');
    const text = fields
      .slice(textIndex)
      .join(',')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ');
    if (start === null || end === null || end <= start || textIndex < 0) continue;
    cues.push({ start, end, text: text.split('\n') });
  }
  return cues;
};

/** Converte o texto já decodificado. Quem chama cuida dos bytes (ver decode.ts). */
export const toWebVtt = (input: string): VttConversion => {
  const text = input.replace(/^﻿/, '');
  if (text.trim() === '') return { ok: false, reason: 'empty' };
  // Quebra de linha pode vir como CRLF, CR isolado ou LF: tudo vira LF antes de contar linhas.
  const lines = text.split(/\r\n|\r|\n/);
  const cues = ASS_SECTION.test(text) ? parseAss(lines) : parseTimed(lines);

  const blocks: string[] = [];
  for (const cue of cues) {
    // "-->" no texto some aqui: ">" já virou "&gt;", então não há como fechar um tempo por engano.
    const body = cue.text
      .map(sanitizeCueLine)
      .filter((l) => l !== '')
      .join('\n');
    if (body === '') continue;
    blocks.push(`${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${body}`);
  }
  if (blocks.length === 0) return { ok: false, reason: 'no_cues' };
  return { ok: true, vtt: `WEBVTT\n\n${blocks.join('\n\n')}\n`, cues: blocks.length };
};
