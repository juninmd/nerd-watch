import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';

/**
 * Versão do app desktop instalado, lida do `package_info` do shell (é a versão que o auto-update compara).
 *
 * No navegador/Docker não existe "app instalado": devolve `null` e a UI não mostra nada.
 */
export const installedVersion = async (): Promise<string | null> => {
  if (!isTauri()) return null;
  try {
    return await getVersion();
  } catch {
    // Sem a permissão `core:app:default` o invoke falha; a tela simplesmente não mostra a versão.
    return null;
  }
};

/** Rótulo exibido na UI. `null`/vazio = sem linha nenhuma (não é um "v" solto). */
export const versionLabel = (version: string | null): string | null =>
  version ? `versão instalada: v${version}` : null;
