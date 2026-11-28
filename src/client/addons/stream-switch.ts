import type { TitleStreamsDto } from '../api/stremio.ts';
import { isPlayable, type StreamPick } from '../player/episode-play-model.ts';
import { streamFacts } from './stream-filter.ts';

/** Fontes que o player troca no meio do vídeo (menu "Fonte" e plano B automático). Sem DOM. */
export interface SourceOption extends StreamPick {
  label: string;
  height: number;
  active: boolean;
}

const playable = (dto: TitleStreamsDto) =>
  dto.addons.flatMap((g) =>
    g.streams.filter(isPlayable).map((s) => ({ addonId: g.addonId, index: s.index, name: g.name, height: streamFacts(s).height })),
  );

const same = (a: StreamPick | null, b: StreamPick): boolean => a?.addonId === b.addonId && a.index === b.index;

/** Uma linha por fonte tocável: resolução primeiro (é o que a pessoa escolhe), depois o addon. */
export const sourceOptions = (dto: TitleStreamsDto, playing: StreamPick | null): SourceOption[] =>
  playable(dto).map((p, i, all) => {
    const twins = all.filter((o) => o.addonId === p.addonId && o.height === p.height).length > 1;
    // Resolução desconhecida fica de fora: o nome do addon basta.
    const res = p.height ? `${p.height >= 2160 ? '4K' : `${p.height}p`} · ` : '';
    return {
      addonId: p.addonId,
      index: p.index,
      height: p.height,
      label: `${res}${p.name}${twins ? ` #${i + 1}` : ''}`,
      active: same(playing, p),
    };
  });

/**
 * Próxima fonte quando a atual falha: a seguinte na lista (dá a volta), nunca uma já tentada.
 * `tried` cresce a cada falha; sem sobra, `null` (aí o aviso de "tente outra" aparece).
 */
export const nextPlayable = (dto: TitleStreamsDto, failed: StreamPick, tried: ReadonlyArray<StreamPick>): StreamPick | null => {
  const all = playable(dto);
  const at = all.findIndex((p) => same(failed, p));
  for (let step = 1; step <= all.length; step++) {
    const cand = all[(Math.max(at, 0) + step) % all.length];
    if (cand && !same(failed, cand) && !tried.some((t) => same(t, cand))) return { addonId: cand.addonId, index: cand.index };
  }
  return null;
};

/** Texto curto do botão na barra: a resolução da fonte tocando, ou "Fonte" quando ela não diz. */
export const sourceTriggerLabel = (options: readonly SourceOption[]): string => {
  const h = options.find((o) => o.active)?.height ?? 0;
  return h ? (h >= 2160 ? '4K' : `${h}p`) : 'Fonte';
};
