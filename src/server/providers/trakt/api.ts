import { readSetting } from '../sources/settings.ts';
import { SourceError } from '../sources/types.ts';
import { traktOAuth } from './oauth.ts';

const API = 'https://api.trakt.tv';
const TIMEOUT_MS = 15_000;

/** Limite de escrita do Trakt é ~1 POST/s por usuário (ver docs/providers/trakt.md). */
export class TraktRateLimitError extends SourceError {
  constructor(retryAfterSeconds: number | null) {
    super(
      retryAfterSeconds
        ? `o Trakt limitou os pedidos — tente de novo em ${retryAfterSeconds}s`
        : 'o Trakt limitou os pedidos — tente de novo daqui a pouco',
      429,
    );
  }
}

const retryAfter = (res: Response): number | null => {
  const seconds = Number(res.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
};

/**
 * Chamada autenticada à API do Trakt. O `authedFetch` já troca o token em 401 (e lança `OAuthReauthRequiredError`
 * quando o refresh é recusado). Erros viram mensagens nossas: o corpo do Trakt nunca sai daqui.
 */
export const traktRequest = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => {
  const res = await traktOAuth.authedFetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      // O client ID é o `trakt-api-key` (não é segredo); o client secret nunca vai em header de API.
      'trakt-api-key': readSetting('TRAKT_CLIENT_ID') ?? '',
      'User-Agent': 'nerd-watch/1.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) throw new TraktRateLimitError(retryAfter(res));
  if (!res.ok) throw new SourceError('o Trakt recusou o pedido agora', 502);
  try {
    return await res.json();
  } catch {
    throw new SourceError('resposta inesperada do Trakt', 502);
  }
};
