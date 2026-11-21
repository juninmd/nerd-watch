import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const ENV_PATH = '.env';

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLAIN_VALUE = /^[A-Za-z0-9_@%+=:,./~-]*$/;

/**
 * O parser de `.env` do Bun trunca em `#`, expande `$VAR` (até entre aspas simples), apara espaços e não trata `\"`:
 * um segredo gravado cru voltaria corrompido no próximo boot. Só `\$` é escape válido nos três tipos de aspas.
 */
export const encodeEnvValue = (value: string): string => {
  if (PLAIN_VALUE.test(value)) return value;
  const quote = ["'", '`', '"'].find((q) => !value.includes(q));
  if (!quote) throw new Error("valor inválido (não pode conter ', \" e ` ao mesmo tempo)");
  // Em aspas duplas `\\` vira `\`; nas outras a barra é literal.
  const literal = quote === '"' ? value.replaceAll('\\', '\\\\') : value;
  return `${quote}${literal.replaceAll('$', '\\$')}${quote}`;
};

/** Atualiza (ou insere) uma variável num arquivo `.env` local, preservando as demais linhas. Nunca loga o valor. */
export const updateEnvVar = (key: string, value: string, path: string = ENV_PATH): void => {
  if (!ENV_KEY.test(key)) throw new Error('nome de variável inválido');
  if (/[\r\n\0]/.test(value)) throw new Error('valor inválido (não pode conter quebra de linha nem byte nulo)');

  const lines = existsSync(path)
    ? readFileSync(path, 'utf-8')
        .split(/\r?\n/)
        .filter((l, i, arr) => l !== '' || i !== arr.length - 1)
    : [];
  const prefix = `${key}=`;
  const line = `${prefix}${encodeEnvValue(value)}`;
  // Remove duplicatas antigas da mesma chave (um .env editado à mão com duas linhas faria a segunda vencer no próximo boot).
  let replaced = false;
  const next: string[] = [];
  for (const existing of lines) {
    if (existing.startsWith(prefix)) {
      if (!replaced) {
        next.push(line);
        replaced = true;
      }
      continue;
    }
    next.push(existing);
  }
  if (!replaced) next.push(line);

  const content = next.join('\n').replace(/\n*$/, '\n');
  // Gravação atômica (arquivo temporário + rename): evita .env truncado se o processo cair no meio da escrita.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch (err) {
      // best-effort — no Windows não há bits POSIX; em POSIX avisa se não conseguiu restringir.
      console.warn('[env-file] não foi possível restringir permissões de', path, '—', err instanceof Error ? err.message : err);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // limpeza melhor esforço
    }
    throw err;
  }
};
