/**
 * Limpeza de texto de nome de arquivo ou legenda, antes de tokenizar: remove ruído de canal (links, @menções,
 * #hashtags, emoji), a extensão do arquivo e troca `.`/`_` por espaço. Não interpreta nada: só normaliza.
 */

const EXTENSION = /\.(?:mkv|mp4|avi|mov|webm|m4v|wmv|mpe?g|flv|ts)$/i;
const URL = /(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)\S*/gi;
const MENTION = /(^|\s)@\w+/g;
const HASHTAG = /(^|\s)#\S+/g;
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/gu;
/** Marca temporária de ponto que não é separador (código de uso privado, fora de qualquer nome real). */
const KEEP_DOT = String.fromCharCode(0xe000);

/**
 * Um caractere por vez: controle (tab incluso), espaço invisível, seletor de variação e bidi viram espaço; traços
 * unicode viram '-'. Por código e não por regex: caractere invisível em regex fica ilegível e o lint o proíbe.
 */
const normalizeChar = (ch: string): string => {
  const code = ch.charCodeAt(0);
  if (code < 32 || code === 127) return ' ';
  if (code === 0xa0 || (code >= 0x200b && code <= 0x200d) || code === 0xfeff || code === 0xfe0f) return ' ';
  if (code >= 0x202a && code <= 0x202e) return ' ';
  if ((code >= 0x2010 && code <= 0x2015) || code === 0x2212) return '-';
  return ch;
};

/** Separa uma linha em palavras preservando `H.264`, `H.265` e canais de áudio (`5.1`), cujo ponto não é separador. */
const separate = (line: string): string =>
  line
    .replace(EXTENSION, '')
    .replace(/(?<=\b[hH])\.(?=26[45]\b)/g, KEEP_DOT)
    .replace(/(?<!\d)(\d)\.(\d)(?!\d)/g, `$1${KEEP_DOT}$2`)
    .replace(/[._]+/g, ' ')
    .replaceAll(KEEP_DOT, '.')
    .replace(/\s+/g, ' ')
    .trim();

/** Uma string por linha não vazia. A primeira linha é o título; as demais só trazem tags. */
export const cleanLines = (input: string): string[] =>
  input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => Array.from(line, normalizeChar).join(''))
    .join('\n')
    .replace(URL, ' ')
    .replace(MENTION, '$1 ')
    .replace(HASHTAG, '$1 ')
    .replace(PICTOGRAPH, ' ')
    .split('\n')
    .map(separate)
    .filter((line) => line.length > 0);
