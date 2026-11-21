import { withCache } from '../lib/cache.ts';
import { CatalogRequestError, httpsUrlOrNull } from '../lib/catalog-text.ts';
import { createRateLimiter, RateLimitExceededError } from '../lib/rate-limit.ts';
import { hasControlChar } from '../lib/text-guards.ts';
import { isRecord } from './tvmaze.ts';

/**
 * Mini biografia de uma pessoa do elenco pelo resumo da Wikipédia (sem chave, texto CC BY-SA: a tela credita e linka).
 * Tenta pt e cai para en. Homônimos são comuns ("Victor Williams"), então só aceitamos resumo que fale de profissão
 * de tela; sem isso, não há bio (melhor nada do que a vida de outra pessoa).
 * Docs: https://en.wikipedia.org/api/rest_v1/ — User-Agent identificável: https://meta.wikimedia.org/wiki/User-Agent_policy
 */
const MINUTES = 60_000;
const TIMEOUT_MS = 4_000;
const MAX_NAME = 120;
const MAX_EXTRACT = 900;
const MAX_SUMMARY_BYTES = 512 * 1024;
const USER_AGENT = 'nerd-watch/1.0 (https://github.com/juninmd/nerd-watch; open-source local media tracker)';
const LANGS = ['pt', 'en'] as const;
// Só termos de tela: "writer"/"singer" aceitavam homônimos de fora (autor, cantor) com a bio de outra pessoa.
const SCREEN_WORK = /\b(at(or|riz|ores)|actor|actress|comedi(an|ante)|humorista|apresentador(a)?|presenter|television host|dubl(ador|adora|agem)|voice actor|voice actress)\b/i;

export interface PersonBio {
  extract: string;
  url: string;
  lang: (typeof LANGS)[number];
}

const limiter = createRateLimiter('Wikipédia', 30, 10_000);

/** Só para testes. */
export const resetWikipediaRateLimitForTests = (): void => limiter.reset();

/** Aceita só artigo comum (não desambiguação) cujo resumo cite trabalho de tela. Pura, para teste. */
export const pickBio = (raw: unknown, lang: PersonBio['lang']): PersonBio | null => {
  if (!isRecord(raw) || raw.type !== 'standard' || typeof raw.extract !== 'string') return null;
  const extract = raw.extract.replace(/\s+/g, ' ').trim();
  if (!extract || !SCREEN_WORK.test(extract)) return null;
  const urls = isRecord(raw.content_urls) && isRecord(raw.content_urls.desktop) ? raw.content_urls.desktop : null;
  // Parênteses (ex.: `Fulano_(ator)`) viram %28/%29: o cliente nunca recebe aspas ou parênteses crus num href.
  const url = httpsUrlOrNull(typeof urls?.page === 'string' ? urls.page.replace(/\(/g, '%28').replace(/\)/g, '%29') : null);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.port || !parsed.hostname.endsWith('.wikipedia.org')) return null;
  const cutAt = extract.lastIndexOf(' ', MAX_EXTRACT);
  const cut = extract.length > MAX_EXTRACT ? `${extract.slice(0, cutAt > 0 ? cutAt : MAX_EXTRACT)}…` : extract;
  return { extract: cut, url, lang };
};

const summary = async (lang: PersonBio['lang'], name: string): Promise<unknown> => {
  try {
    limiter.acquire();
  } catch (err) {
    if (err instanceof RateLimitExceededError) throw new CatalogRequestError(429, err.message);
    throw err;
  }
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CatalogRequestError(502, 'Wikipédia indisponível no momento');
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new CatalogRequestError(502, `Wikipédia respondeu ${res.status}`);
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SUMMARY_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  return res.json().catch(() => null);
};

/** `null` quando nenhum idioma tem um resumo confiável para o nome. */
export const wikipediaBio = withCache(24 * 60 * MINUTES, async (name: string): Promise<PersonBio | null> => {
  const clean = name.trim();
  if (!clean || clean.length > MAX_NAME || hasControlChar(clean)) return null;
  for (const lang of LANGS) {
    const bio = pickBio(await summary(lang, clean), lang);
    if (bio) return bio;
  }
  return null;
});
