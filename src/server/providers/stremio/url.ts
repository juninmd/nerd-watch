import { ValidationError } from '../../lib/validation-error.ts';
import { isFetchableSubtitleUrl } from '../../subtitles/url-guard.ts';

const MAX_URL_LENGTH = 2048;

export interface AddonUrl {
  /** URL completa do manifest (pode carregar token no caminho; nunca vai para o cliente). */
  manifestUrl: string;
  /** Base dos recursos (manifest sem `/manifest.json`, sem barra final). */
  baseUrl: string;
  /** Só o domínio: o que a interface pode mostrar sem vazar token do caminho. */
  host: string;
}

/**
 * Valida o link colado pelo usuário. Aceita `https://…/manifest.json` e `stremio://…/manifest.json`
 * (o esquema do botão "instalar" dos addons). O servidor vai buscar essa URL, então só entra host
 * público, sem credenciais embutidas; a checagem do DNS resolvido fica em `client.ts`.
 */
export const parseAddonUrl = (raw: unknown): AddonUrl => {
  if (typeof raw !== 'string') throw new ValidationError('informe o link do manifest do addon');
  let text = raw.trim();
  if (!text) throw new ValidationError('informe o link do manifest do addon');
  if (text.length > MAX_URL_LENGTH) throw new ValidationError('link grande demais');
  if (/^stremio:\/\//i.test(text)) text = text.replace(/^stremio:\/\//i, 'https://');

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ValidationError('link inválido');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ValidationError('use um link http(s) ou stremio://');
  if (!isFetchableSubtitleUrl(url.href)) throw new ValidationError('o endereço precisa ser um site público (sem localhost, rede local ou usuário:senha no link)');
  if (!/\/manifest\.json$/i.test(url.pathname)) throw new ValidationError('o link deve terminar em /manifest.json');

  // Query (`?config=`) é rara e carrega segredo com facilidade: recusamos em vez de adivinhar onde ela entraria.
  if (url.search) throw new ValidationError('links com parâmetros (?…) não são suportados; use o link do manifest sem query');
  url.hash = '';
  const baseUrl = `${url.origin}${url.pathname.replace(/\/manifest\.json$/i, '')}`.replace(/\/+$/, '');
  return { manifestUrl: url.href, baseUrl, host: url.host };
};
