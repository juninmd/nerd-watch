import { ValidationError } from '../../lib/validation-error.ts';
import type { InstalledAddon } from '../../repo/stremio-addons.ts';
import { AddonError } from './client.ts';
import { fetchManifestFrom } from './protocol.ts';

/**
 * Saúde do addon com cache curto.
 *
 * A tela de addons pede o status de cada um ao abrir; sem cache isso vira uma requisição de manifest
 * por addon **a cada visita** — peso para um serviço de terceiros e tela mais lenta. Aqui:
 *
 * - resposta boa fica 60 s em cache, erro fica 10 s (um addon fora do ar não é martelado, mas também
 *   não fica marcado como quebrado por um minuto inteiro);
 * - duas visitas simultâneas compartilham a mesma requisição (in-flight dedupe);
 * - o cache é por id instalado, em memória; reiniciar o app limpa tudo.
 */
export interface AddonStatus {
  ok: boolean;
  error: string | null;
}

export const STATUS_TTL_MS = 60_000;
export const STATUS_ERROR_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 256;

const cache = new Map<string, { at: number; status: AddonStatus }>();
const inflight = new Map<string, Promise<AddonStatus>>();

/** Remove o cache de um addon removido ou reinstalado. */
export const invalidateAddonStatus = (id: string): void => {
  cache.delete(id);
};

/** Só para teste: começa limpo em cada caso. */
export const resetAddonStatusCache = (): void => {
  cache.clear();
  inflight.clear();
};

const messageOf = (err: unknown): string => {
  if (err instanceof AddonError || err instanceof ValidationError) return err.message;
  return 'não foi possível verificar o addon';
};

export const addonStatus = async (
  addon: Pick<InstalledAddon, 'id' | 'manifestUrl'>,
  options: { now?: () => number; check?: (manifestUrl: string) => Promise<unknown> } = {},
): Promise<AddonStatus> => {
  const now = options.now ?? Date.now;
  const check = options.check ?? fetchManifestFrom;

  const cached = cache.get(addon.id);
  if (cached) {
    const ttl = cached.status.ok ? STATUS_TTL_MS : STATUS_ERROR_TTL_MS;
    if (now() - cached.at < ttl) return cached.status;
  }

  const pending = inflight.get(addon.id);
  if (pending) return pending;

  const task = check(addon.manifestUrl).then(
    (): AddonStatus => ({ ok: true, error: null }),
    (err: unknown): AddonStatus => ({ ok: false, error: messageOf(err) }),
  );
  inflight.set(addon.id, task);
  try {
    const status = await task;
    cache.delete(addon.id);
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(addon.id, { at: now(), status });
    return status;
  } finally {
    inflight.delete(addon.id);
  }
};
