import type { Context } from 'hono';
import { ValidationError } from '../validation-error.ts';

/** Corpo JSON de listas e visões: pequeno por desenho. Acima disso é erro antes de qualquer parse. */
export const JSON_BODY_MAX_BYTES = 16 * 1024;

export class BodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
  }
}

/** Lê o corpo como objeto JSON, com teto de bytes. Array, número ou texto no lugar do objeto é 400. */
export const readJsonObject = async (c: Context, maxBytes = JSON_BODY_MAX_BYTES): Promise<Record<string, unknown>> => {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new BodyError('corpo grande demais', 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BodyError('corpo inválido: esperado JSON', 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BodyError('corpo deve ser um objeto JSON', 400);
  return parsed as Record<string, unknown>;
};

/** Chave fora da lista permitida é erro: um campo com grafia errada não pode ser ignorado em silêncio. */
export const assertKnownKeys = (body: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`campo desconhecido: ${key}`);
};

const INT = /^\d+$/;

/** `limit` e `offset` da query: inteiros, limit dentro de 1..max, offset não negativo. Ausentes usam o padrão. */
export const parsePage = (limitRaw: string | undefined, offsetRaw: string | undefined, max: number, fallback: number): { limit: number; offset: number } => {
  const limit = limitRaw === undefined ? fallback : INT.test(limitRaw) ? Number(limitRaw) : Number.NaN;
  const offset = offsetRaw === undefined ? 0 : INT.test(offsetRaw) ? Number(offsetRaw) : Number.NaN;
  if (!(limit >= 1 && limit <= max)) throw new ValidationError(`limit deve ser inteiro entre 1 e ${max}`);
  if (!Number.isSafeInteger(offset)) throw new ValidationError('offset deve ser um inteiro não negativo');
  return { limit, offset };
};

/** Traduz erro de entrada em resposta; qualquer outro erro segue para o handler padrão (500). */
export const guardInput = async (c: Context, run: () => Response | Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (err) {
    if (err instanceof BodyError) return c.json({ error: err.message }, err.status);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }
};
