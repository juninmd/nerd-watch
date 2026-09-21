import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

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
  // `mode` no writeFileSync só é aplicado na CRIAÇÃO do arquivo — se o .env já existia (ex.: copiado de
  // .env.example, herdando o umask, tipicamente 644/mundo-legível), atualizações seguintes mantinham a
  // permissão antiga mesmo depois de gravar TELEGRAM_SESSION nele. chmod explícito cobre os dois casos.
  // (No-op efetivo no Windows, que não tem bits POSIX — lá o controle real é a ACL do arquivo/pasta.)
  try {
    chmodSync(path, 0o600);
  } catch (err) {
    // best-effort — não bloqueia a gravação da credencial por causa disso, mas uma falha aqui (ex.: EPERM
    // num arquivo de outro dono) deixa a credencial world-readable sem nenhum sinal se ficar em silêncio.
    console.warn('[env-file] não foi possível restringir permissões de', path, '—', err instanceof Error ? err.message : err);
  }
};
