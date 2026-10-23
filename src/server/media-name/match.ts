import type { ParsedMediaName } from './parse.ts';

/**
 * Casamento determinístico entre o nome de um vídeo do canal e um título da biblioteca do usuário.
 * Sem rede e sem palpite: quando não dá para ter certeza, o resultado é "sem vínculo" (ou sugestão para confirmar).
 */

/** Título da biblioteca com os episódios já conhecidos (temporada >= 1; especiais entram quando o nome pede). */
export interface LinkCandidate {
  titleId: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  episodes: Array<{ season: number; episode: number }>;
}

export type LinkDecision =
  | {
      status: 'linked' | 'suggested';
      titleId: string;
      season: number;
      episode: number;
      episodeEnd?: number;
      confidence: number;
    }
  | { status: 'unlinked'; reason: 'no_name' | 'no_title' | 'no_episode' | 'ambiguous' };

/**
 * Pontuação: 0.5 por título exato; +0.3 se o ano do nome bate; +0.2 se a temporada veio escrita no nome.
 * Vincula sozinho só com ano e temporada batendo (1.0). Sem um deles, é sugestão para o usuário confirmar.
 * Número absoluto (anime sem temporada) fica em 0.5 ou 0.8: nunca vincula sozinho.
 */
export const AUTO_LINK_MIN = 0.9;
export const SUGGEST_MIN = 0.5;

/** Minúsculas, sem acento e com pontuação virando espaço: "Pokémon: Show." vira "pokemon show". */
export const normalizeName = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

interface Resolved {
  season: number;
  episode: number;
  episodeEnd?: number;
  explicitSeason: boolean;
}

const has = (c: LinkCandidate, season: number, episode: number): boolean =>
  c.episodes.some((e) => e.season === season && e.episode === episode);

/**
 * Acha a temporada e o episódio no candidato. Sem temporada no nome: a única temporada vale; com várias, o número
 * é absoluto (anime), contado na ordem das temporadas. Intervalo só vale com temporada explícita ou única.
 */
const resolveEpisode = (parsed: ParsedMediaName, c: LinkCandidate): Resolved | null => {
  if (parsed.episode === undefined) return null;
  const episode = parsed.episode;
  const episodeEnd = parsed.episodeEnd !== undefined && parsed.episodeEnd > episode ? parsed.episodeEnd : undefined;
  const seasons = [...new Set(c.episodes.map((e) => e.season).filter((s) => s >= 1))].sort((a, b) => a - b);

  if (parsed.season !== undefined) {
    const last = episodeEnd ?? episode;
    for (let e = episode; e <= last; e++) if (!has(c, parsed.season, e)) return null;
    return { season: parsed.season, episode, episodeEnd, explicitSeason: true };
  }

  if (seasons.length === 1 && seasons[0] !== undefined) {
    const season = seasons[0];
    const last = episodeEnd ?? episode;
    for (let e = episode; e <= last; e++) if (!has(c, season, e)) return null;
    return { season, episode, episodeEnd, explicitSeason: false };
  }

  if (episodeEnd !== undefined || seasons.length === 0) return null;
  const absolute = c.episodes.filter((e) => e.season >= 1).sort((a, b) => a.season - b.season || a.episode - b.episode);
  const hit = absolute[episode - 1];
  // Só a 1ª temporada: fora dela, o número cruza temporadas que podem estar incompletas no banco (palpite).
  if (!hit || hit.season !== seasons[0]) return null;
  return { season: hit.season, episode: hit.episode, explicitSeason: false };
};

export const matchParsedName = (parsed: ParsedMediaName, candidates: LinkCandidate[]): LinkDecision => {
  const key = normalizeName(parsed.title);
  if (!key) return { status: 'unlinked', reason: 'no_name' };

  const scored: Array<{ titleId: string; score: number; decision: LinkDecision }> = [];
  let episodeMissing = false;

  for (const c of candidates) {
    const keys = [c.title, c.originalTitle].filter((t): t is string => !!t).map(normalizeName);
    if (!keys.includes(key)) continue;
    // Ano escrito no nome e diferente do da biblioteca: outro título (remake, sequência), não este.
    if (parsed.year !== undefined && c.year !== null && c.year !== parsed.year) continue;

    const r = resolveEpisode(parsed, c);
    if (!r) {
      episodeMissing = true;
      continue;
    }
    const yearAgrees = parsed.year !== undefined && c.year === parsed.year;
    const score = 0.5 + (yearAgrees ? 0.3 : 0) + (r.explicitSeason ? 0.2 : 0);
    scored.push({
      titleId: c.titleId,
      score,
      decision: {
        status: score >= AUTO_LINK_MIN ? 'linked' : 'suggested',
        titleId: c.titleId,
        season: r.season,
        episode: r.episode,
        episodeEnd: r.episodeEnd,
        confidence: Math.round(score * 100) / 100,
      },
    });
  }

  const sorted = scored.sort((a, b) => b.score - a.score);
  const best = sorted[0];
  if (!best) return { status: 'unlinked', reason: episodeMissing ? 'no_episode' : 'no_title' };
  if (sorted[1] && sorted[1].score === best.score) return { status: 'unlinked', reason: 'ambiguous' };
  return best.decision;
};
