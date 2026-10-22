import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateEnvVar } from '../src/server/env-file.ts';

const TEST_PATH = `${import.meta.dir}/../.tmp-env-file-test.env`;

afterEach(() => {
  if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH);
});

describe('updateEnvVar', () => {
  test('cria o arquivo quando ele não existe', () => {
    updateEnvVar('FOO', 'bar', TEST_PATH);
    expect(readFileSync(TEST_PATH, 'utf-8')).toBe('FOO=bar\n');
  });

  test('insere uma nova variável preservando as existentes', () => {
    writeFileSync(TEST_PATH, 'PORT=7799\nTMDB_API_KEY=x\n');
    updateEnvVar('TELEGRAM_BOT_TOKEN', '123:abc', TEST_PATH);
    const content = readFileSync(TEST_PATH, 'utf-8');
    expect(content).toContain('PORT=7799');
    expect(content).toContain('TMDB_API_KEY=x');
    expect(content).toContain('TELEGRAM_BOT_TOKEN=123:abc');
  });

  test('atualiza uma variável existente no lugar, sem duplicar', () => {
    writeFileSync(TEST_PATH, 'PORT=7799\nTELEGRAM_BOT_TOKEN=old\nDB_PATH=data/x.db\n');
    updateEnvVar('TELEGRAM_BOT_TOKEN', 'new', TEST_PATH);
    const lines = readFileSync(TEST_PATH, 'utf-8').trim().split('\n');
    expect(lines).toEqual(['PORT=7799', 'TELEGRAM_BOT_TOKEN=new', 'DB_PATH=data/x.db']);
  });

  test('rejeita valores com quebra de linha (evita injeção de outras variáveis)', () => {
    expect(() => updateEnvVar('TELEGRAM_BOT_TOKEN', 'x\nEVIL=1', TEST_PATH)).toThrow();
  });
});

describe('updateEnvVar — o valor volta igual quando o Bun lê o arquivo no próximo boot', () => {
  // O parser do Bun trunca em `#`, expande `$VAR` (até entre aspas simples) e não trata `\"`: gravar cru corrompe a senha em silêncio.
  const VALUES: Record<string, string> = {
    HASH: 'ab#cd',
    EXPAND: 'a${USER}b',
    DOLLAR: 'x$HOME_NOPE',
    QUOTES: `p "q" 'r'`,
    DQUOTE: 'pa"ss',
    LEAD: '  espaço nas pontas  ',
    SLASH: 'back\slash',
    ESCDOLLAR: 'a\$b',
    PLAIN: 'abc123:+/=',
  };

  test('segredos com #, $, aspas, barra e espaço sobrevivem ao round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nw-env-'));
    try {
      for (const [key, value] of Object.entries(VALUES)) updateEnvVar(key, value, join(dir, '.env'));
      const env = { ...process.env } as Record<string, string>;
      delete env.NODE_ENV;
      const script = `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(VALUES))}.map((k) => [k, process.env[k]]))))`;
      const run = Bun.spawnSync([process.execPath, '-e', script], { cwd: dir, env, stdout: 'pipe' });
      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout.toString())).toEqual(VALUES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
