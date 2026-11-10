/**
 * Calcula (e opcionalmente aplica) a próxima versão a partir dos commits convencionais desde a
 * última tag. É o passo que decide se o release roda: sem commit que peça release, `changed=false`
 * e o workflow para antes de compilar.
 *
 * Uso:
 *   bun run scripts/next-version.ts            # imprime { version, bump, changed }
 *   bun run scripts/next-version.ts --apply    # grava a versão em package.json, tauri.conf.json e Cargo.toml
 *
 * Em CI também escreve `version`/`changed` no `$GITHUB_OUTPUT`.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bumpVersion, nextVersion, type CommitInfo } from '../src/shared/release-version.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAURI_CONF = `${ROOT}src-tauri/tauri.conf.json`;
const PACKAGE_JSON = `${ROOT}package.json`;
const CARGO_TOML = `${ROOT}src-tauri/Cargo.toml`;

const git = (...args: string[]): string => {
  const run = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')} falhou: ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
};

/** Última tag `vX.Y.Z`; sem tag, a versão base é a do tauri.conf.json (primeiro release). */
const lastTag = (): string => {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*').trim();
  } catch {
    return '';
  }
};

const tauriVersion = (): string => JSON.parse(readFileSync(TAURI_CONF, 'utf8')).version;

const commitsSince = (ref: string): CommitInfo[] => {
  const raw = git('log', '--format=%x1e%s%x1f%b', ref ? `${ref}..HEAD` : 'HEAD');
  return raw
    .split('\x1e')
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [subject = '', body = ''] = record.split('\x1f');
      return { subject: subject.trim(), body: body.trim() };
    });
};

const setOutput = (key: string, value: string): void => {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
};

/** Reescreve só o campo de versão, preservando o resto do arquivo (sem reformatar JSON à mão). */
const applyVersion = (version: string): void => {
  for (const file of [PACKAGE_JSON, TAURI_CONF]) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.version = version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
  const cargo = readFileSync(CARGO_TOML, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`);
  writeFileSync(CARGO_TOML, cargo);
};

const apply = process.argv.includes('--apply');
// `--bump patch|minor|major` força o tipo quando os commits não pedem release (bootstrap, hotfix).
const forced = (() => {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === '--bump' || arg.startsWith('--bump='));
  if (index < 0) return 'auto';
  const arg = args[index] ?? '';
  const value = arg.includes('=') ? arg.split('=')[1] : args[index + 1];
  return value === 'patch' || value === 'minor' || value === 'major' ? value : 'auto';
})();
const tag = lastTag();
const base = tag || tauriVersion();
const result =
  forced === 'auto' ? nextVersion(base, commitsSince(tag)) : { version: bumpVersion(base, forced) ?? base, bump: forced };

if (!result) {
  console.log(`sem commit que peça release desde ${base} — nenhuma tag será criada`);
  setOutput('changed', 'false');
  process.exit(0);
}

if (apply) applyVersion(result.version);
setOutput('changed', 'true');
setOutput('version', result.version);
console.log(`próxima versão: ${base} -> ${result.version} (${result.bump})${apply ? ' — aplicada nos arquivos' : ''}`);
