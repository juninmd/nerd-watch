/** Normalização do que vem de APIs de catálogo: texto sem marcação e URLs https. Compartilhado por TVmaze e AniList. */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };

/** HTML (TVmaze) ou texto com `<br>` (AniList) para texto puro. A saída ainda é escapada pelo cliente. */
export const htmlToText = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
};

/** Só aceita `https:` sem credenciais embutidas: o que vai para o navegador como imagem nunca vira `javascript:` ou http. */
export const httpsUrlOrNull = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    // Checado no texto original: o `href` já teria espaço codificado como %20. Aspas e parênteses quebrariam o `url('...')` do cliente.
    if (/['"()\\<>\s]/.test(raw)) return null;
    return url.href;
  } catch {
    return null;
  }
};

/** Falha de um catálogo externo, já com mensagem nossa: o corpo cru da API nunca chega ao navegador. */
export class CatalogRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogRequestError';
  }
}
