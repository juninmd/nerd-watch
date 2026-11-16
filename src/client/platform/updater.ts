import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Atualização achada pelo shell desktop (`check_update`). */
export interface UpdateInfo {
  version: string;
  current: string;
  notes: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** Só o app instalado se atualiza; no navegador/Docker a atualização é `git pull`/imagem nova. */
export const updaterAvailable = (): boolean => isTauri();

/** `null` = já na versão mais nova. Lança se a rede ou o `latest.json` falhar. */
export const checkForUpdate = async (): Promise<UpdateInfo | null> => invoke<UpdateInfo | null>('check_update');

/** Baixa, verifica a assinatura, instala e reinicia. `onProgress` alimenta a barra de progresso. */
export const installUpdate = async (onProgress: (p: UpdateProgress) => void): Promise<void> => {
  const stop = await listen<UpdateProgress>('update-progress', (event) => onProgress(event.payload));
  try {
    await invoke('install_update');
  } finally {
    stop();
  }
};
