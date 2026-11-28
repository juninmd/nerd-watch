/**
 * Trechos para "pular abertura/recapitulação/créditos". Duas bases comunitárias, sem chave:
 * - IntroDB (`api.introdb.app`), por id do IMDb, para filmes e séries;
 * - AniSkip (`api.aniskip.com`), por id do MyAnimeList, para anime (como o SkipTimes do stream-goat).
 * Só funções puras aqui: recebem o JSON e devolvem trechos em segundos, ordenados.
 */
export type SkipKind = 'intro' | 'recap' | 'credits';

export interface SkipSegment {
  kind: SkipKind;
  start: number;
  end: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

const valid = (s: SkipSegment): boolean => s.end > s.start && s.end - s.start <= 15 * 60;
const sorted = (list: SkipSegment[]): SkipSegment[] => list.filter(valid).sort((a, b) => a.start - b.start);

const INTRODB_KINDS: Array<[string, SkipKind]> = [
  ['intro', 'intro'],
  ['recap', 'recap'],
  ['outro', 'credits'],
];

export const parseIntroDb = (body: unknown): SkipSegment[] => {
  if (!isRecord(body)) return [];
  const out: SkipSegment[] = [];
  for (const [field, kind] of INTRODB_KINDS) {
    const seg = body[field];
    if (!isRecord(seg)) continue;
    const start = num(seg.start_sec);
    const end = num(seg.end_sec);
    if (start !== null && end !== null) out.push({ kind, start, end });
  }
  return sorted(out);
};

const ANISKIP_KINDS: Record<string, SkipKind> = { op: 'intro', 'mixed-op': 'intro', ed: 'credits', 'mixed-ed': 'credits', recap: 'recap' };

/**
 * A AniSkip manda um trecho por envio, de versões com durações diferentes. Para cada tipo fica o envio cuja
 * duração do episódio mais se aproxima do vídeo tocando (sem duração, o primeiro).
 */
export const parseAniSkip = (body: unknown, duration: number | null): SkipSegment[] => {
  if (!isRecord(body) || !Array.isArray(body.results)) return [];
  const best = new Map<SkipKind, { seg: SkipSegment; gap: number }>();
  for (const r of body.results) {
    if (!isRecord(r) || typeof r.skipType !== 'string' || !isRecord(r.interval)) continue;
    const kind = ANISKIP_KINDS[r.skipType];
    const start = num(r.interval.startTime);
    const end = num(r.interval.endTime);
    if (!kind || start === null || end === null) continue;
    const length = num(r.episodeLength);
    const gap = duration && length ? Math.abs(length - duration) : Number.POSITIVE_INFINITY;
    const cur = best.get(kind);
    if (!cur || gap < cur.gap) best.set(kind, { seg: { kind, start, end }, gap });
  }
  return sorted([...best.values()].map((b) => b.seg));
};
