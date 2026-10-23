/**
 * Só http(s): a URL do sink sai do ambiente e o fetch aceita outros esquemas (file:, data:…). Devolve a URL aparada
 * ou `undefined`; nunca lança, e quem chama nunca precisa ecoar o valor rejeitado no log.
 */
export const parseHttpUrl = (raw: string | undefined): string | undefined => {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
};
