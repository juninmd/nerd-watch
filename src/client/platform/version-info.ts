import { health } from '../api/health.ts';
import { fetchLatestRelease, isNewer } from './update-check.ts';
import { installedVersion, versionLabel } from './version.ts';

/** Mostra a versão em `el` e, se houver release mais nova no GitHub, um link discreto para baixar. */
export const mountVersionInfo = async (el: HTMLElement): Promise<void> => {
  // Desktop: versão do app instalado. Navegador/Docker: a do servidor, via /api/health.
  const installed = await installedVersion();
  const version = installed ?? (await health().then((h) => h.version ?? null).catch(() => null));
  if (!version) return;
  el.textContent = installed ? versionLabel(installed) : `versão: v${version}`;
  el.hidden = false;
  const latest = await fetchLatestRelease();
  if (!latest || !isNewer(latest.version, version)) return;
  const link = document.createElement('a');
  link.href = latest.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `Nova versão v${latest.version} disponível`;
  el.append(link);
};
