import { parseVersion } from '../../shared/release-version.ts';

/** Última release publicada no GitHub (a mesma fonte do auto-update do desktop). */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/juninmd/nerd-watch/releases/latest';
const CACHE_KEY = 'nerd-watch:latest-release';
/** Uma consulta a cada 6 h basta; a API anônima do GitHub limita a 60/h por IP. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface LatestRelease {
  version: string;
  url: string;
}

/** `true` só quando `latest` é estritamente maior; versão inválida nunca vira aviso. */
export const isNewer = (latest: string, current: string): boolean => {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
};

const isSafeReleaseUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.origin === 'https://github.com' && u.pathname.startsWith('/juninmd/nerd-watch/') && !/["'<>]/.test(raw);
  } catch {
    return false;
  }
};

/** Extrai `{ version, url }` da resposta da API, ignorando rascunho/pré-lançamento e payload estranho. */
export const parseRelease = (data: unknown): LatestRelease | null => {
  if (!data || typeof data !== 'object') return null;
  const { tag_name, html_url, draft, prerelease } = data as Record<string, unknown>;
  if (draft === true || prerelease === true) return null;
  if (typeof tag_name !== 'string' || typeof html_url !== 'string') return null;
  const parsed = parseVersion(tag_name);
  if (!parsed || !isSafeReleaseUrl(html_url)) return null;
  return { version: parsed.join('.'), url: html_url };
};

interface Deps {
  fetcher?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
}

const defaultStorage = (): Deps['storage'] => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** Release mais recente, com cache local. Falha de rede/limite → `null` (a UI só não mostra aviso). */
export const fetchLatestRelease = async (deps: Deps = {}): Promise<LatestRelease | null> => {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const now = (deps.now ?? Date.now)();
  try {
    const cached = JSON.parse(storage?.getItem(CACHE_KEY) ?? 'null') as { at: number; release: LatestRelease | null } | null;
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.release;
  } catch {
    // cache corrompido: segue para a rede
  }
  try {
    const response = await (deps.fetcher ?? fetch)(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const release = parseRelease(await response.json());
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify({ at: now, release }));
    } catch {
      // sem armazenamento: só perde o cache
    }
    return release;
  } catch {
    return null;
  }
};
