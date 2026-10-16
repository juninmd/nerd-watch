/**
 * Escolha do arquivo de vídeo dentro de um torrent da Internet Archive.
 *
 * Um item da Archive carrega MUITO mais que o filme: derivados de áudio, spectrograms,
 * thumbnails, `.afpk` (fingerprints do player deles), `.meta.xml`, `_rules.conf`, arquivos
 * internos de nome puramente numérico. Escolher por tamanho — o reflexo natural — erra feio
 * nos dois sentidos: pega um MP4 de 4 GB quando existe um derivado leve, e pega um clipe de
 * 11 MB do DVD quando o filme de verdade tem 400 MB (medido no item `Sita_Sings_the_Blues`).
 *
 * A Archive resolve isso com uma convenção de nomes estável para os derivados do vídeo
 * principal, que é o que este módulo explora. O filtro por tipo de arquivo é só o
 * `isPlayableVideo` de `media/playable.ts` — não há lista de "lixo" aqui, porque tudo que não é
 * MP4/WebM (`.afpk`, `.png`, `.ogg`, arquivos de nome numérico) já cai fora por ele.
 *
 * Tudo aqui é função pura, pra ser testável sem rede nem torrent.
 */

import { isPlayableVideo } from '../media/playable.ts';

/**
 * Convenção de derivados de vídeo da Archive.org, do mais leve/rápido ao mais pesado.
 * O número é a *preferência* (menor = melhor pra começar a assistir), não a qualidade: o
 * `_512kb.mp4` é o que o próprio player do archive.org usa por padrão pra tocar no browser.
 * Os nomes vêm de itens reais — `_480p_2150kbps.mp4` e `_720p.mp4` aparecem no
 * `Sita_Sings_the_Blues`, por exemplo.
 */
const DERIVATIVE_PREFERENCE: Array<{ match: RegExp; rank: number; label: string }> = [
  { match: /_512kb\.mp4$/i, rank: 1, label: '512 kbps (início rápido)' },
  { match: /_small\.mp4$/i, rank: 2, label: 'small' },
  { match: /_(240|360)p(_\d+kbps)?\.mp4$/i, rank: 3, label: '240p/360p' },
  { match: /_medium\.mp4$/i, rank: 4, label: 'medium' },
  { match: /_large\.mp4$/i, rank: 5, label: 'large' },
  { match: /_480p(_\d+kbps)?\.mp4$/i, rank: 6, label: '480p' },
  { match: /_720p(_\d+kbps)?\.mp4$/i, rank: 7, label: '720p' },
  { match: /_hd\.mp4$/i, rank: 7, label: 'HD' },
  { match: /_1080p(_\d+kbps)?\.mp4$/i, rank: 8, label: '1080p' },
];

/** Tier de quem não casa com nenhum derivado conhecido (o "original" ou um recorte avulso). */
const UNKNOWN_DERIVATIVE = 90;

/** Abaixo disso é clipe/amostra, não o filme — não deve ser a escolha automática. */
const MIN_FEATURE_BYTES = 5 * 1024 * 1024;

export interface TorrentFileLike {
  name: string;
  length: number;
}

export interface VideoCandidate {
  index: number;
  name: string;
  length: number;
  /** Menor = derivado mais leve (preferido); 90 = sem convenção conhecida (o "original"). */
  preference: number;
  /** Rótulo curto pro seletor da interface. */
  label: string;
}

const labelFor = (name: string, preference: number): string => {
  const matched = DERIVATIVE_PREFERENCE.find((entry) => entry.match.test(name));
  if (matched) return matched.label;
  if (preference === UNKNOWN_DERIVATIVE) {
    const ext = name.slice(name.lastIndexOf('.') + 1).toUpperCase();
    return `${ext} original`;
  }
  return name;
};

/**
 * Vídeos que o navegador toca, ordenados por preferência (mais leve primeiro) e, dentro do
 * mesmo tier, do menor pro maior. `index` é a posição no array original de arquivos do torrent.
 */
export const rankVideoFiles = (files: readonly TorrentFileLike[]): VideoCandidate[] =>
  files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => isPlayableVideo(file.name))
    .map(({ file, index }) => {
      const matched = DERIVATIVE_PREFERENCE.find((entry) => entry.match.test(file.name));
      const preference = matched?.rank ?? UNKNOWN_DERIVATIVE;
      return { index, name: file.name, length: file.length, preference, label: labelFor(file.name, preference) };
    })
    .sort((a, b) => a.preference - b.preference || a.length - b.length);

/**
 * Escolha automática: o primeiro candidato que já tem tamanho de filme de verdade. Se nenhum
 * atingir o piso (item só com derivados curtos), cai no primeiro da ordem de preferência —
 * melhor tocar algo do que travar o botão.
 */
export const pickDefaultVideo = (files: readonly TorrentFileLike[]): VideoCandidate | null => {
  const ranked = rankVideoFiles(files);
  return ranked.find((candidate) => candidate.length >= MIN_FEATURE_BYTES) ?? ranked[0] ?? null;
};

/** O `index` pedido pelo cliente é válido e aponta para um vídeo tocável? */
export const resolveVideoIndex = (files: readonly TorrentFileLike[], index: number | undefined): VideoCandidate | null => {
  if (index === undefined) return pickDefaultVideo(files);
  return rankVideoFiles(files).find((candidate) => candidate.index === index) ?? null;
};

export { MIN_FEATURE_BYTES };
