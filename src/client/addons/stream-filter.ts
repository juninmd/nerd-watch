import type { TitleStreamDto, TitleStreamsDto } from '../api/stremio.ts';
import { parseStreamDetails } from './stream-details.ts';

/** P2P = torrent; direto = vídeo que toca aqui (url/YouTube); externo = abre fora do app. */
export type StreamKind = 'all' | 'p2p' | 'direct' | 'external';
export type StreamSort = 'addon' | 'seeds' | 'quality';

export interface StreamFilter {
  kind: StreamKind;
  /** Resolução mínima em linhas (0 = qualquer). */
  minHeight: number;
  sort: StreamSort;
}

export const DEFAULT_STREAM_FILTER: StreamFilter = { kind: 'all', minHeight: 0, sort: 'addon' };

const HEIGHT: Record<string, number> = { '4K': 2160, '1080p': 1080, '720p': 720, '480p': 480, CAM: 1 };

export const kindOf = (s: TitleStreamDto): Exclude<StreamKind, 'all'> | null => {
  if (s.kind === 'torrent') return 'p2p';
  if (s.kind === 'url' || s.kind === 'youtube') return 'direct';
  if (s.kind === 'external') return 'external';
  return null;
};

/** Lê resolução e seeds dos selos já extraídos pelo cartão: uma regra só para mostrar e para filtrar. */
export const streamFacts = (s: TitleStreamDto): { height: number; seeds: number | null } => {
  let height = 0;
  let seeds: number | null = null;
  for (const b of parseStreamDetails(s).badges) {
    if (height === 0 && HEIGHT[b.label]) height = HEIGHT[b.label] ?? 0;
    const m = /^(\d+) seeds?$/.exec(b.label);
    if (m) seeds = Number(m[1]);
  }
  return { height, seeds };
};

const keep = (s: TitleStreamDto, f: StreamFilter): boolean => {
  const kind = kindOf(s);
  // Aviso do addon (kind `error`) só aparece em "todas": explica a ausência de links, não é um link.
  if (f.kind !== 'all' && kind !== f.kind) return false;
  if (f.minHeight > 0 && kind !== null && streamFacts(s).height < f.minHeight) return false;
  return true;
};

/** Filtra e ordena dentro de cada addon; a ordem dos addons é a da instalação. Não altera o DTO recebido. */
export const filterTitleStreams = (dto: TitleStreamsDto, f: StreamFilter): TitleStreamsDto => ({
  ...dto,
  addons: dto.addons.map((a) => {
    const streams = a.streams.filter((s) => keep(s, f));
    if (f.sort === 'seeds') streams.sort((x, y) => (streamFacts(y).seeds ?? -1) - (streamFacts(x).seeds ?? -1));
    if (f.sort === 'quality') streams.sort((x, y) => streamFacts(y).height - streamFacts(x).height);
    return { ...a, streams };
  }),
});

export const countStreamKinds = (dto: TitleStreamsDto): Record<StreamKind, number> => {
  const out: Record<StreamKind, number> = { all: 0, p2p: 0, direct: 0, external: 0 };
  for (const a of dto.addons)
    for (const s of a.streams) {
      const k = kindOf(s);
      if (!k) continue;
      out.all++;
      out[k]++;
    }
  return out;
};
