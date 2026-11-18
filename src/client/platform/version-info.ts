import { health } from '../api/health.ts';
import { fetchLatestRelease, isNewer, type LatestRelease } from './update-check.ts';
import { installedVersion, versionLabel } from './version.ts';

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

/** Mostra a versão em `el` e, se houver release mais nova no GitHub, um link discreto para baixar. */
export const mountVersionInfo = async (el: HTMLElement): Promise<void> => {
  const status = await resolveVersionStatus();
  if (!status) return;
  el.textContent = status.installed ? versionLabel(status.version) : `versão: v${status.version}`;
  el.hidden = false;
  if (!status.latest) return;
  const link = document.createElement('a');
  link.href = status.latest.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `Nova versão v${status.latest.version} disponível`;
  el.append(link);
};
