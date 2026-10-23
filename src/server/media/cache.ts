import { createHash } from 'node:crypto';
import { readdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

/**
 * Cache dos arquivos convertidos (remux). Nomes são gerados pelo servidor (hash), nunca vêm do usuário, e o caminho
 * do arquivo de origem não aparece no nome.
 */

export const cacheKey = (parts: readonly (string | number)[]): string =>
  createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 40);

export const cachePath = (dir: string, key: string): string => path.join(dir, `${key}.mp4`);

export interface CacheEntry {
  name: string;
  size: number;
  mtimeMs: number;
}

/**
 * LRU pura: escolhe o que apagar para o total caber em `maxBytes`. Começa pelo menos usado (mtime mais antigo) e pula
 * o que está em uso agora (`keep`). Nunca apaga um arquivo que um job ainda escreve.
 */
export const planEvictions = (
  entries: readonly CacheEntry[],
  maxBytes: number,
  keep: ReadonlySet<string>,
): string[] => {
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  const victims: string[] = [];
  const oldestFirst = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  for (const entry of oldestFirst) {
    if (total <= maxBytes) break;
    if (keep.has(entry.name)) continue;
    victims.push(entry.name);
    total -= entry.size;
  }
  return victims;
};

/**
 * Só nomes que este módulo gera (hash de 40 hex). Se TRANSCODE_CACHE_DIR apontar para uma pasta com outros arquivos
 * (ou para a biblioteca do usuário), eles nunca são listados, apagados nem contados.
 */
const OWN_MP4 = /^[0-9a-f]{40}\.mp4$/;
const OWN_PART = /^[0-9a-f]{40}\.mp4\.part$/;

const listFinished = async (dir: string): Promise<CacheEntry[]> => {
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: CacheEntry[] = [];
  for (const name of names) {
    if (!OWN_MP4.test(name)) continue;
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) entries.push({ name, size: info.size, mtimeMs: info.mtimeMs });
  }
  return entries;
};

/** Aplica o teto: apaga pelo LRU até caber. `keep` são os nomes em uso (não entram na conta de remoção). */
export const enforceCacheLimit = async (
  dir: string,
  maxBytes: number,
  keep: ReadonlySet<string>,
): Promise<string[]> => {
  const victims = planEvictions(await listFinished(dir), maxBytes, keep);
  // Um arquivo aberto por um player (EBUSY no Windows) não pode abortar a limpeza nem marcar a conversão como erro.
  const removed: string[] = [];
  for (const name of victims) {
    try {
      await rm(path.join(dir, name), { force: true });
      removed.push(name);
    } catch {
      // segue para o próximo; a próxima conversão tenta de novo
    }
  }
  return removed;
};

/** Marca o arquivo como usado agora, para o LRU não apagá-lo logo depois de um acesso. */
export const touchCache = async (file: string): Promise<void> => {
  const now = new Date();
  await utimes(file, now, now).catch(() => undefined);
};

/** Apaga restos de conversões interrompidas (`*.part`) de um boot anterior. Só este diretório, só este sufixo. */
export const removeOrphanParts = async (dir: string): Promise<number> => {
  const names = await readdir(dir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    if (!OWN_PART.test(name)) continue;
    await rm(path.join(dir, name), { force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
};
