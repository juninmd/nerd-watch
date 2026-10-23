import { describe, expect, test } from 'bun:test';
import { parseProbe } from '../src/server/media/probe-parse.ts';

describe('parseProbe: saída do ffprobe reduzida ao que a decisão usa', () => {
  test('lê vídeo, áudio com idioma e legenda de texto', () => {
    const info = parseProbe({
      format: { duration: '3600.5', format_name: 'matroska,webm' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', field_order: 'progressive' },
        { index: 1, codec_type: 'audio', codec_name: 'ac3', tags: { language: 'POR' }, disposition: { default: 1 }, channels: 6 },
        { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'und' } },
        { index: 3, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' },
      ],
    });
    expect(info.durationSeconds).toBe(3600.5);
    expect(info.video).toEqual({ streamIndex: 0, codec: 'h264', pixFmt: 'yuv420p', interlaced: false });
    expect(info.audio).toEqual([{ ordinal: 0, codec: 'ac3', language: 'por', isDefault: true, channels: 6 }]);
    expect(info.subtitles).toEqual([
      { ordinal: 0, codec: 'subrip', language: null, text: true },
      { ordinal: 1, codec: 'hdmv_pgs_subtitle', language: null, text: false },
    ]);
  });

  test('capa embutida não é o vídeo principal, mesmo quando vem primeiro', () => {
    const info = parseProbe({
      format: {},
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        { index: 1, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
      ],
    });
    expect(info.video?.streamIndex).toBe(1);
  });

  test('duração ausente no contêiner usa a do maior stream; sem nenhuma, null', () => {
    const fromStream = parseProbe({ format: {}, streams: [{ index: 0, codec_type: 'video', duration: '42.0' }] });
    expect(fromStream.durationSeconds).toBe(42);
    expect(parseProbe({ format: { duration: 'N/A' }, streams: [{ index: 0, codec_type: 'video' }] }).durationSeconds).toBeNull();
  });

  test('entrelaçamento vem de field_order; "unknown" não é entrelaçado', () => {
    const tff = parseProbe({ format: {}, streams: [{ index: 0, codec_type: 'video', field_order: 'tt' }] });
    const unk = parseProbe({ format: {}, streams: [{ index: 0, codec_type: 'video', field_order: 'unknown' }] });
    expect(tff.video?.interlaced).toBe(true);
    expect(unk.video?.interlaced).toBe(false);
  });

  test('lixo e formas inesperadas nunca lançam: viram "sem esse dado"', () => {
    for (const raw of [null, 42, 'x', [], {}, { streams: 'nope' }, { streams: [null, 3, { codec_type: 'video' }] }, { format: [], streams: [{ index: 'a' }] }]) {
      const info = parseProbe(raw);
      expect(info.video).toBeNull();
      expect(info.audio).toEqual([]);
      expect(info.subtitles).toEqual([]);
    }
  });

  test('códigos com caixa estranha e espaços são normalizados', () => {
    const info = parseProbe({ format: { format_name: ' Matroska ' }, streams: [{ index: 0, codec_type: 'Video', codec_name: ' H264 ', pix_fmt: 'YUV420P' }] });
    expect(info.formatName).toBe('matroska');
    expect(info.video?.codec).toBe('h264');
    expect(info.video?.pixFmt).toBe('yuv420p');
  });
});
