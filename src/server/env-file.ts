import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ENV_PATH = '.env';

/** Atualiza (ou insere) uma variável num arquivo `.env` local, preservando as demais linhas. Nunca loga o valor. */
export const updateEnvVar = (key: string, value: string, path: string = ENV_PATH): void => {
  if (/[\r\n]/.test(value)) throw new Error('valor inválido (não pode conter quebra de linha)');

  const lines = existsSync(path) ? readFileSync(path, 'utf-8').split('\n').filter((l, i, arr) => l !== '' || i !== arr.length - 1) : [];
  const pattern = new RegExp(`^${key}=`);
  const line = `${key}=${value}`;
  const index = lines.findIndex((l) => pattern.test(l));
  if (index >= 0) lines[index] = line;
  else lines.push(line);

  const content = lines.join('\n').replace(/\n*$/, '\n');
  writeFileSync(path, content, { mode: 0o600 });
};
