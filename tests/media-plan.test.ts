import { describe, expect, test } from 'bun:test';
import { chooseAudio, decidePlan } from '../src/server/media/plan.ts';
import { parseProbe, type ProbeInfo } from '../src/server/media/probe-parse.ts';

const LANGS = ['por', 'pt', 'eng', 'en'];

/** Probe mínimo montado a partir de um ffprobe falso (mesma forma que o parser recebe). */
const probeOf = (video: Record<string, unknown> | null, audio: Record<string, unknown>[] = []): ProbeInfo =>
  parseProbe({
    format: { duration: '12.5', format_name: 'matroska,webm' },
    streams: [
      ...(video ? [{ index: 0, codec_type: 'video', ...video }] : []),
      ...audio.map((a, i) => ({ index: (video ? 1 : 0) + i, codec_type: 'audio', ...a })),
    ],
  });

const H264_8BIT = { codec_name: 'h264', pix_fmt: 'yuv420p', field_order: 'progressive' };
const AAC = { codec_name: 'aac', tags: { language: 'eng' }, disposition: { default: 1 }, channels: 2 };

describe('decidePlan: caminho mais barato', () => {
  test('H.264 8 bits progressivo com AAC vai por remux com áudio copiado', () => {
    expect(decidePlan(probeOf(H264_8BIT, [AAC]), { preferredLangs: LANGS })).toEqual({
      path: 'remux',
      videoStreamIndex: 0,
      audioOrdinal: 0,
      audio: 'copy',
    });
  });

  test('MP3 e Opus também são copiados sem recodificar', () => {
    for (const codec of ['mp3', 'opus']) {
      const plan = decidePlan(probeOf(H264_8BIT, [{ codec_name: codec }]), { preferredLangs: LANGS });
      expect(plan).toMatchObject({ path: 'remux', audio: 'copy' });
    }
  });

  test('H.264 com áudio AC-3 ou FLAC mantém o vídeo e converte só o áudio para AAC', () => {
    for (const codec of ['ac3', 'flac', 'dts', 'vorbis']) {
      const plan = decidePlan(probeOf(H264_8BIT, [{ codec_name: codec }]), { preferredLangs: LANGS });
      expect(plan).toMatchObject({ path: 'remux', audio: 'aac' });
    }
  });

  test('vídeo sem áudio vira remux sem trilha de áudio', () => {
    expect(decidePlan(probeOf(H264_8BIT, []), { preferredLangs: LANGS })).toEqual({ path: 'remux', videoStreamIndex: 0, audioOrdinal: null, audio: 'none' });
  });

  test('HEVC precisa de transcodificação, mesmo com áudio copiável', () => {
    expect(decidePlan(probeOf({ codec_name: 'hevc', pix_fmt: 'yuv420p', field_order: 'progressive' }, [AAC]), { preferredLangs: LANGS })).toEqual({
      path: 'transcode',
      videoStreamIndex: 0,
      audioOrdinal: 0,
      deinterlace: false,
    });
  });

  test('H.264 10 bits (yuv420p10le) é transcodificado', () => {
    const plan = decidePlan(probeOf({ codec_name: 'h264', pix_fmt: 'yuv420p10le', field_order: 'progressive' }, [AAC]), { preferredLangs: LANGS });
    expect(plan).toMatchObject({ path: 'transcode' });
  });

  test('H.264 em 4:2:2 ou sem pix_fmt não é copiado (dúvida vira recodificação)', () => {
    for (const pix of ['yuv422p', '']) {
      const plan = decidePlan(probeOf({ codec_name: 'h264', pix_fmt: pix, field_order: 'progressive' }, [AAC]), { preferredLangs: LANGS });
      expect(plan).toMatchObject({ path: 'transcode' });
    }
  });

  test('entrelaçado (tt/bb/tb/bt) vai para transcodificação com desentrelaçamento', () => {
    for (const order of ['tt', 'bb', 'tb', 'bt']) {
      const plan = decidePlan(probeOf({ codec_name: 'h264', pix_fmt: 'yuv420p', field_order: order }, [AAC]), { preferredLangs: LANGS });
      expect(plan).toMatchObject({ path: 'transcode', deinterlace: true });
    }
  });

  test('field_order desconhecido ou ausente não é tratado como entrelaçado', () => {
    for (const order of ['unknown', undefined]) {
      const plan = decidePlan(probeOf({ codec_name: 'h264', pix_fmt: 'yuv420p', field_order: order }, [AAC]), { preferredLangs: LANGS });
      expect(plan).toMatchObject({ path: 'remux' });
    }
  });

  test('MPEG-4 parte 2, VP9, AV1, WMV e MPEG-2 são transcodificados', () => {
    for (const codec of ['mpeg4', 'vp9', 'av1', 'wmv3', 'mpeg2video']) {
      const plan = decidePlan(probeOf({ codec_name: codec, pix_fmt: 'yuv420p' }, [AAC]), { preferredLangs: LANGS });
      expect(plan.path).toBe('transcode');
    }
  });

  test('sem trilha de vídeo (só áudio) é indisponível, com motivo para a UI', () => {
    const plan = decidePlan(probeOf(null, [AAC]), { preferredLangs: LANGS });
    expect(plan).toEqual({ path: 'unavailable', reason: 'o arquivo não tem trilha de vídeo' });
  });

  test('capa do arquivo (attached_pic) não conta como vídeo', () => {
    const probe = parseProbe({
      format: {},
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        { index: 1, codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p' },
      ],
    });
    expect(decidePlan(probe, { preferredLangs: LANGS })).toMatchObject({ path: 'transcode', videoStreamIndex: 1 });
  });
});

describe('chooseAudio: escolha da trilha', () => {
  const tracks = (...langs: (string | null)[]) => langs.map((language, ordinal) => ({ ordinal, codec: 'aac', language, isDefault: false, channels: 2 }));

  test('sem áudio, null', () => {
    expect(chooseAudio([], LANGS)).toBeNull();
  });

  test('prefere o idioma da lista, na ordem da lista', () => {
    expect(chooseAudio(tracks('jpn', 'eng', 'por'), LANGS)).toBe(2);
    expect(chooseAudio(tracks('jpn', 'en'), LANGS)).toBe(1);
  });

  test('sem idioma conhecido, usa a marcada como padrão e depois a primeira', () => {
    const withDefault = tracks('jpn', 'fra');
    withDefault[1] = { ...withDefault[1], isDefault: true } as (typeof withDefault)[number];
    expect(chooseAudio(withDefault, LANGS)).toBe(1);
    expect(chooseAudio(tracks('jpn', 'fra'), LANGS)).toBe(0);
  });

  test('a trilha pedida pelo usuário vence, se existir; inexistente cai no padrão', () => {
    expect(chooseAudio(tracks('jpn', 'eng'), LANGS, 0)).toBe(0);
    expect(chooseAudio(tracks('jpn', 'eng'), LANGS, 7)).toBe(1);
  });
});
