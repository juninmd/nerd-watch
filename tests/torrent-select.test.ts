import { describe, expect, test } from 'bun:test';
import { MIN_FEATURE_BYTES, pickDefaultVideo, rankVideoFiles, resolveVideoIndex } from '../src/server/torrent/select.ts';

const MB = 1024 * 1024;

/**
 * Lista real (recortada) do item `Sita_Sings_the_Blues` da Internet Archive, coletada em execução.
 * É o caso que quebra heurístico ingênuo de "pega o maior arquivo": há um MP4 de 4.4 GB de 1080p
 * e dois recortes curtos de DVD, então nem o maior nem o menor são a resposta certa.
 */
const SITA_FILES = [
  { name: 'Sita_Sings_the_Blues_audio_only.ogg', length: 58 * MB },
  { name: '17', length: 0.7 * MB },
  { name: 'Sita_Sings_the_Blues_audio_only.png', length: 0.02 * MB },
  { name: '52', length: 4.2 * MB },
  { name: 'Sita_Sings_the_Blues_audio_only_spectrogram.png', length: 0.3 * MB },
  { name: 'Sita_Sings_the_Blues_large.gif', length: 0.4 * MB },
  { name: 'Sita_Sings_the_Blues_large.mp4', length: 872 * MB },
  { name: 'Sita_Sings_the_Blues_medium.mp4', length: 499.8 * MB },
  { name: 'Sita_Sings_the_Blues_small.mp4', length: 223.6 * MB },
  { name: 'Sita_Sings_the_Blues_1080p.mp4', length: 4428.8 * MB },
  { name: 'Sita_Sings_the_Blues_DVD_NTSC3.mp4', length: 29 * MB },
  { name: 'Sita_Sings_the_Blues_DVD_NTSC4.mp4', length: 11 * MB },
  { name: 'Sita_Sings_the_Blues_meta.xml', length: 0.01 * MB },
  { name: '_HOUR_00_SSTB_MASTER_LoRo_01.L.afpk', length: 0.6 * MB },
  { name: '__ia_thumb.jpg', length: 0.02 * MB },
  { name: '_rules.conf', length: 0.001 * MB },
];

describe('rankVideoFiles', () => {
  test('ignora lixo da Archive: numéricos, afpk, spectrogram, gif, xml e conf', () => {
    const names = rankVideoFiles(SITA_FILES).map((c) => c.name);
    expect(names).not.toContain('17');
    expect(names).not.toContain('_HOUR_00_SSTB_MASTER_LoRo_01.L.afpk');
    expect(names).not.toContain('Sita_Sings_the_Blues_audio_only_spectrogram.png');
    expect(names).not.toContain('Sita_Sings_the_Blues_large.gif');
    expect(names).not.toContain('Sita_Sings_the_Blues_meta.xml');
    expect(names).not.toContain('_rules.conf');
  });

  test('exclui contêiner que o navegador não toca (.ogg)', () => {
    expect(rankVideoFiles(SITA_FILES).map((c) => c.name)).not.toContain('Sita_Sings_the_Blues_audio_only.ogg');
  });

  test('ordena do derivado mais leve ao mais pesado, com os sem-convenção por último', () => {
    expect(rankVideoFiles(SITA_FILES).map((c) => c.name)).toEqual([
      'Sita_Sings_the_Blues_small.mp4',
      'Sita_Sings_the_Blues_medium.mp4',
      'Sita_Sings_the_Blues_large.mp4',
      'Sita_Sings_the_Blues_1080p.mp4',
      'Sita_Sings_the_Blues_DVD_NTSC4.mp4',
      'Sita_Sings_the_Blues_DVD_NTSC3.mp4',
    ]);
  });

  test('mantém o index original do torrent, não a posição no ranking', () => {
    const small = rankVideoFiles(SITA_FILES).find((c) => c.name.endsWith('_small.mp4'));
    expect(small?.index).toBe(SITA_FILES.findIndex((f) => f.name === 'Sita_Sings_the_Blues_small.mp4'));
  });

  test('rotula os derivados conhecidos em português', () => {
    const labels = rankVideoFiles([{ name: 'filme_512kb.mp4', length: 200 * MB }]);
    expect(labels[0]?.label).toBe('512 kbps (início rápido)');
  });
});

describe('pickDefaultVideo', () => {
  test('escolhe o derivado leve, não o arquivo de 4.4 GB nem o clipe de 11 MB', () => {
    const picked = pickDefaultVideo(SITA_FILES);
    expect(picked?.name).toBe('Sita_Sings_the_Blues_small.mp4');
  });

  test('prefere o 512kb quando é o único derivado (caso sex_madness)', () => {
    const picked = pickDefaultVideo([
      { name: 'sex_madness.ogv', length: 223 * MB },
      { name: 'sex_madness_512kb.mp4', length: 227 * MB },
    ]);
    expect(picked?.name).toBe('sex_madness_512kb.mp4');
  });

  test('cai no original quando ele é o único tocável (caso Utopia.mp4)', () => {
    const picked = pickDefaultVideo([
      { name: 'Utopia.ogv', length: 358 * MB },
      { name: 'Utopia.mp4', length: 563 * MB },
    ]);
    expect(picked?.name).toBe('Utopia.mp4');
    expect(picked?.label).toBe('MP4 original');
  });

  test('ignora clipe abaixo do piso de filme quando existe algo maior', () => {
    const picked = pickDefaultVideo([
      { name: 'trailer.mp4', length: 1 * MB },
      { name: 'filme.mp4', length: MIN_FEATURE_BYTES + 1 },
    ]);
    expect(picked?.name).toBe('filme.mp4');
  });

  test('null quando não há nada que o navegador toque', () => {
    expect(pickDefaultVideo([{ name: 'filme.ogv', length: 200 * MB }])).toBeNull();
    expect(pickDefaultVideo([])).toBeNull();
  });
});

describe('resolveVideoIndex', () => {
  test('sem índice, delega para a escolha automática', () => {
    expect(resolveVideoIndex(SITA_FILES, undefined)?.name).toBe('Sita_Sings_the_Blues_small.mp4');
  });

  test('aceita um índice de vídeo tocável pedido pelo cliente', () => {
    const want = SITA_FILES.findIndex((f) => f.name === 'Sita_Sings_the_Blues_1080p.mp4');
    expect(resolveVideoIndex(SITA_FILES, want)?.name).toBe('Sita_Sings_the_Blues_1080p.mp4');
  });

  test('recusa índice de arquivo que não é vídeo tocável', () => {
    const ogv = SITA_FILES.findIndex((f) => f.name === 'Sita_Sings_the_Blues_audio_only.ogg');
    const junk = SITA_FILES.findIndex((f) => f.name === '17');
    expect(resolveVideoIndex(SITA_FILES, ogv)).toBeNull();
    expect(resolveVideoIndex(SITA_FILES, junk)).toBeNull();
    expect(resolveVideoIndex(SITA_FILES, 9999)).toBeNull();
  });
});
