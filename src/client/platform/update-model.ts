/** Lógica pura da tela de atualização (sem DOM), para ter teste. */

/** Percentual 0–100 do download; `null` quando o servidor não informa o tamanho total. */
export const progressPercent = (downloaded: number, total: number | null): number | null => {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
};

const MB = 1024 * 1024;

export const formatMegabytes = (bytes: number): string => `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;

/** Texto da barra: "42% · 8,1 de 19,3 MB" ou só o baixado quando o total é desconhecido. */
export const progressLabel = (downloaded: number, total: number | null): string => {
  const pct = progressPercent(downloaded, total);
  if (pct === null || !total) return `${formatMegabytes(downloaded)} baixados`;
  return `${pct}% · ${formatMegabytes(downloaded)} de ${formatMegabytes(total)}`;
};
