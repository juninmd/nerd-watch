/**
 * Saída do ffprobe (`-print_format json`) reduzida ao que a decisão de reprodução usa. Função pura: recebe o JSON já
 * decodificado e nunca lança, porque o arquivo é externo e pode vir truncado ou com campos faltando.
 */
export interface VideoInfo {
  /** Índice absoluto do stream no arquivo (usado em `-map 0:<index>`). */
  streamIndex: number;
  codec: string;
  pixFmt: string;
  interlaced: boolean;
}

export interface AudioInfo {
  /** Ordem entre os streams de áudio (`0:a:<ordinal>`). */
  ordinal: number;
  codec: string;
  language: string | null;
  isDefault: boolean;
  channels: number;
}

export interface SubtitleInfo {
  /** Ordem entre os streams de legenda (`0:s:<ordinal>`). */
  ordinal: number;
  codec: string;
  language: string | null;
  /** Texto (converte para WebVTT). Legenda gráfica (PGS, VobSub) não entra. */
  text: boolean;
}

export interface ProbeInfo {
  durationSeconds: number | null;
  formatName: string;
  /** Primeiro stream de vídeo que não é capa (`attached_pic`). Null quando o arquivo só tem áudio. */
  video: VideoInfo | null;
  audio: AudioInfo[];
  subtitles: SubtitleInfo[];
}

const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const INTERLACED_ORDERS = new Set(['tt', 'bb', 'tb', 'bt']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const language = (stream: Obj): string | null => {
  const tags = isObj(stream.tags) ? stream.tags : {};
  const lang = str(tags.language);
  return lang && lang !== 'und' ? lang : null;
};

const durationOf = (format: Obj, streams: Obj[]): number | null => {
  const fromFormat = num(format.duration);
  if (fromFormat !== null && fromFormat > 0) return fromFormat;
  // Contêiner sem duração (fluxo, MKV sem Duration): o maior stream costuma trazer a do arquivo.
  const fromStream = streams.map((s) => num(s.duration) ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return fromStream > 0 ? fromStream : null;
};

/** Qualquer forma inesperada vira "sem esse dado", nunca exceção: o plano decide com o que sobrou. */
export const parseProbe = (raw: unknown): ProbeInfo => {
  const root = isObj(raw) ? raw : {};
  const format = isObj(root.format) ? root.format : {};
  const streams = (Array.isArray(root.streams) ? root.streams : []).filter(isObj);

  let video: VideoInfo | null = null;
  const audio: AudioInfo[] = [];
  const subtitles: SubtitleInfo[] = [];
  for (const s of streams) {
    const type = str(s.codec_type);
    const index = num(s.index);
    const disposition = isObj(s.disposition) ? s.disposition : {};
    if (index === null) continue;
    if (type === 'video' && video === null && num(disposition.attached_pic) !== 1) {
      video = {
        streamIndex: index,
        codec: str(s.codec_name),
        pixFmt: str(s.pix_fmt),
        interlaced: INTERLACED_ORDERS.has(str(s.field_order)),
      };
    } else if (type === 'audio') {
      audio.push({
        ordinal: audio.length,
        codec: str(s.codec_name),
        language: language(s),
        isDefault: num(disposition.default) === 1,
        channels: num(s.channels) ?? 0,
      });
    } else if (type === 'subtitle') {
      const codec = str(s.codec_name);
      subtitles.push({
        ordinal: subtitles.length,
        codec,
        language: language(s),
        text: TEXT_SUBTITLE_CODECS.has(codec),
      });
    }
  }

  return {
    durationSeconds: durationOf(format, streams),
    formatName: str(format.format_name),
    video,
    audio,
    subtitles,
  };
};
