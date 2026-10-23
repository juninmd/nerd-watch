/**
 * Registra o service worker só em contexto seguro (localhost ou https), que é onde o browser o aceita. Falha
 * de registro não pode quebrar o app: ele continua funcionando, só sem casca offline.
 */
export const registerShellWorker = async (): Promise<void> => {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[pwa] service worker não registrado:', err);
  }
};
