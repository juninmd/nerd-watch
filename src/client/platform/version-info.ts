import { health } from '../api/health.ts';
import { fetchLatestRelease, isNewer, type LatestRelease } from './update-check.ts';
import { installedVersion } from './version.ts';

export interface VersionStatus {
  version: string;
  /** `true` = app desktop instalado; `false` = versão do servidor (navegador/Docker). */
  installed: boolean;
  latest: LatestRelease | null;
}

/** Versão em uso e, só se a release do GitHub for estritamente maior, a nova. Sem versão → `null`. */
export const resolveVersionStatus = async (): Promise<VersionStatus | null> => {
  // Desktop: versão do app instalado. Navegador/Docker: a do servidor, via /api/health.
  const desktop = await installedVersion();
  const version = desktop ?? (await health().then((h) => h.version ?? null).catch(() => null));
  if (!version) return null;
  const release = await fetchLatestRelease();
  return { version, installed: desktop !== null, latest: release && isNewer(release.version, version) ? release : null };
};
