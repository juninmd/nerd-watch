import type { AudioInfo, ProbeInfo } from './probe-parse.ts';

/**
 * Caminho mais barato que entrega algo tocável no `<video>`:
 * - `direct`: contêiner que o navegador já toca (mp4/m4v/webm). Nada é feito.
 * - `remux`: vídeo H.264 8 bits não entrelaçado. O vídeo é copiado (`-c:v copy`); o áudio é copiado se já for
 *   AAC/MP3/Opus, senão vira AAC. Gera um MP4 em cache com Range.
 * - `transcode`: o vídeo precisa ser recodificado (HEVC, 10 bits, entrelaçado, MPEG-4, VP9, etc.). Sai como MP4
 *   fragmentado em stream, com `?start=` para seek.
 * - `unavailable`: não há o que tocar (sem trilha de vídeo). O motivo vai para a UI.
 */
export type Plan =
  | { path: 'unavailable'; reason: string }
  | { path: 'remux'; videoStreamIndex: number; audioOrdinal: number | null; audio: 'copy' | 'aac' | 'none' }
  | { path: 'transcode'; videoStreamIndex: number; audioOrdinal: number | null; deinterlace: boolean };

/** Codecs de áudio que entram no MP4 sem recodificar e que o Chrome/Firefox tocam. */
const COPYABLE_AUDIO = new Set(['aac', 'mp3', 'opus']);

/**
 * Escolhe a trilha de áudio: a pedida pelo usuário (se existir), senão a primeira na lista de idiomas preferidos, senão
 * a marcada como padrão, senão a primeira. Sem áudio, `null`.
 */
export const chooseAudio = (audio: AudioInfo[], preferredLangs: string[], requested?: number): number | null => {
  if (audio.length === 0) return null;
  if (requested !== undefined && audio.some((a) => a.ordinal === requested)) return requested;
  for (const lang of preferredLangs) {
    const hit = audio.find((a) => a.language === lang);
    if (hit) return hit.ordinal;
  }
  return (audio.find((a) => a.isDefault) ?? (audio[0] as AudioInfo)).ordinal;
};

/** Vídeo copiável: H.264 em 4:2:0 de 8 bits e progressivo. Qualquer dúvida (sem pix_fmt) cai em recodificar. */
const videoCopyable = (video: NonNullable<ProbeInfo['video']>): boolean =>
  video.codec === 'h264' && (video.pixFmt === 'yuv420p' || video.pixFmt === 'yuvj420p') && !video.interlaced;

/**
 * Decisão pura (sem I/O). A ordem importa: sem vídeo não há o que fazer; vídeo copiável é remux (barato, sem perda);
 * todo o resto é transcodificação. Quem chama já respondeu `direct` para contêineres nativos antes de sondar.
 */
export const decidePlan = (probe: ProbeInfo, opts: { preferredLangs: string[]; audioOrdinal?: number }): Plan => {
  const { video } = probe;
  if (!video) return { path: 'unavailable', reason: 'o arquivo não tem trilha de vídeo' };

  const audioOrdinal = chooseAudio(probe.audio, opts.preferredLangs, opts.audioOrdinal);
  const track = audioOrdinal === null ? null : (probe.audio.find((a) => a.ordinal === audioOrdinal) ?? null);

  if (!videoCopyable(video)) {
    return { path: 'transcode', videoStreamIndex: video.streamIndex, audioOrdinal, deinterlace: video.interlaced };
  }
  let audio: 'copy' | 'aac' | 'none' = 'none';
  if (track) audio = COPYABLE_AUDIO.has(track.codec) ? 'copy' : 'aac';
  return { path: 'remux', videoStreamIndex: video.streamIndex, audioOrdinal, audio };
};
