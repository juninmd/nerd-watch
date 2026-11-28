import type { TitleStreamsDto } from '../api/stremio.ts';
import { streamFacts } from '../addons/stream-filter.ts';

export type PlaySource = 'tvmaze' | 'tmdb';

/** Fonte escolhida da última vez: o próximo episódio tenta o mesmo addon na mesma resolução. */
export interface StreamPref {
  addonId: string;
  height: number;
}

export interface StreamPick {
  addonId: string;
  index: number;
}

export interface SeasonCount {
  number: number;
  count: number;
}

type Stream = TitleStreamsDto['addons'][number]['streams'][number];

/** Só o que o player do app toca na tela: arquivo direto e torrent. YouTube/externo/aviso ficam na lista. */
export const isPlayable = (s: Stream): boolean => s.kind === 'url' || s.kind === 'torrent';

export const playPath = (source: PlaySource, id: string, season: number, episode: number): string => `/play/${source}/${id}/${season}/${episode}`;

/**
 * Capa em alta: a TVmaze e a TMDB servem a mesma imagem em outros tamanhos trocando só o trecho do caminho.
 * Qualquer outra URL volta como veio (nunca inventa host).
 */
export const hdStill = (url: string | null): string | null => {
  if (!url) return null;
  if (/^https:\/\/static\.tvmaze\.com\/uploads\/images\/medium_(landscape|portrait)\//.test(url)) return url.replace(/\/medium_(landscape|portrait)\//, '/original_untouched/');
  if (/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+\//.test(url)) return url.replace(/\/t\/p\/w\d+\//, '/t/p/w1280/');
  return url;
};

/**
 * Escolhe o stream que começa a tocar: o clicado (se ainda tocável), senão o mesmo addon na mesma resolução,
 * o mesmo addon em qualquer resolução, outro addon na mesma resolução e, por fim, o primeiro tocável.
 */
export const pickStream = (dto: TitleStreamsDto, pref: StreamPref | null, explicit: StreamPick | null = null): StreamPick | null => {
  const all = dto.addons.flatMap((g) => g.streams.filter(isPlayable).map((s) => ({ addonId: g.addonId, index: s.index, height: streamFacts(s).height })));
  if (explicit && all.some((s) => s.addonId === explicit.addonId && s.index === explicit.index)) return explicit;
  const found =
    (pref &&
      (all.find((s) => s.addonId === pref.addonId && s.height === pref.height) ??
        all.find((s) => s.addonId === pref.addonId) ??
        all.find((s) => pref.height > 0 && s.height === pref.height))) ??
    all[0];
  return found ? { addonId: found.addonId, index: found.index } : null;
};

/**
 * Episódio vizinho atravessando temporadas; especiais (temporada 0) e temporadas vazias ficam fora.
 * `numbers` (os números reais da temporada atual) resolve buracos na numeração; sem ele, conta de 1 até `count`.
 */
export const neighborEpisode = (
  seasons: SeasonCount[],
  season: number,
  episode: number,
  dir: 1 | -1,
  numbers?: number[],
): { season: number; episode: number } | null => {
  const real = seasons.filter((s) => s.number > 0 && s.count > 0).sort((a, b) => a.number - b.number);
  const i = real.findIndex((s) => s.number === season);
  if (i < 0) return null;
  const cur = real[i] as SeasonCount;
  if (numbers?.length) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const at = sorted.indexOf(episode);
    const hit = at >= 0 ? sorted[at + dir] : undefined;
    if (hit !== undefined) return { season, episode: hit };
  } else if (episode + dir >= 1 && episode + dir <= cur.count) return { season, episode: episode + dir };
  const other = real[i + dir];
  if (!other) return null;
  // Na outra temporada a numeração real ainda não foi carregada: a tela encaixa no primeiro/último que existir.
  return { season: other.number, episode: dir === 1 ? 1 : other.count };
};

/**
 * Episódio que o "Assistir" da ficha abre: o seguinte ao marcador (o marcador é o último visto), o próprio
 * marcador quando a série acabou, ou o primeiro episódio da 1ª temporada sem marcador.
 */
export const playTarget = (
  seasons: SeasonCount[],
  marker: { season: number; episode: number } | null,
): { season: number; episode: number; resume: boolean } | null => {
  const first = seasons.filter((s) => s.number > 0 && s.count > 0).sort((a, b) => a.number - b.number)[0];
  if (!marker) return first ? { season: first.number, episode: 1, resume: false } : null;
  const next = neighborEpisode(seasons, marker.season, marker.episode, 1);
  return next ? { ...next, resume: true } : { ...marker, resume: true };
};
