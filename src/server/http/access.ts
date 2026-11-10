import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Acesso remoto opcional, ligado só com `ACCESS_TOKEN`. Sem ele o app segue local-first, sem nenhuma checagem
 * extra. Com ele, toda rota `/api` exige o token (Bearer para scripts, cookie de sessão para o navegador e
 * para o `<video>`). Este arquivo é só lógica pura: o middleware e as rotas de login ficam em `access-guard.ts`.
 */
export const ACCESS_TOKEN_MIN_LENGTH = 16;

export class AccessTokenError extends Error {
  constructor() {
    super(
      `ACCESS_TOKEN precisa ter pelo menos ${ACCESS_TOKEN_MIN_LENGTH} caracteres (o valor não é exibido por segurança)`,
    );
    this.name = 'AccessTokenError';
  }
}

/** Vazio ou só espaços significa "sem acesso remoto" (mesmo comportamento das demais variáveis do config). */
export const parseAccessToken = (raw: string | undefined): string | undefined => {
  const token = raw?.trim() ?? '';
  if (token === '') return undefined;
  if (token.length < ACCESS_TOKEN_MIN_LENGTH) throw new AccessTokenError();
  return token;
};

/**
 * Digest antes de comparar: os dois lados viram 32 bytes, então `timingSafeEqual` nunca recebe tamanhos
 * diferentes (que lançaria) e o tamanho do token não vaza pelo tempo de resposta.
 */
const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export const safeEqual = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

/** Geração aleatória por processo: reinício e logout trocam a geração e invalidam todas as sessões antigas. */
export const newGeneration = (): string => randomBytes(32).toString('base64url');

const SESSION_CONTEXT = 'nerd-watch:session:v1:';

/**
 * Valor do cookie de sessão: HMAC do token com a geração como mensagem. O cookie nunca carrega o token, e
 * sem a geração (que nunca sai do processo) não dá para montá-lo.
 */
export const sessionValue = (token: string, generation: string): string =>
  createHmac('sha256', token).update(`${SESSION_CONTEXT}${generation}`).digest('base64url');

/** `/api` e tudo abaixo dele, sem diferenciar caixa: quem não casar com a allowlist cai no guard. */
export const isApiPath = (p: string): boolean => p === '/api' || p.toLowerCase().startsWith('/api/');

/**
 * Allowlist mínima. Fora de `/api` ficam o front estático e o login/logout (que também são públicos) e o único
 * `GET /api/health` exato, que só devolve flags booleanas. `rawPath` e `routedPath` são checados os dois:
 * o Hono decodifica `%61pi` antes de rotear, então qualquer um dos dois apontando para `/api` já protege.
 */
export const isPublicPath = (method: string, rawPath: string, routedPath: string): boolean => {
  if (!isApiPath(rawPath) && !isApiPath(routedPath)) return true;
  return (method === 'GET' || method === 'HEAD') && rawPath === '/api/health' && routedPath === '/api/health';
};

/** `Secure` quando a requisição veio por https, ou quando o proxy é confiável e disse que veio por https. */
export const isSecureRequest = (url: string, forwardedProto: string | undefined, trustProxy: boolean): boolean => {
  if (new URL(url).protocol === 'https:') return true;
  if (!trustProxy || !forwardedProto) return false;
  return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
};
