import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../../src/server/config/config.ts';
import { maskSecret } from '../../src/server/credentials/registry.ts';
import { setTesterFetchForTests } from '../../src/server/credentials/tester.ts';
import { credentialsRoutes } from '../../src/server/routes/credentials.ts';

const TMDB = 'a'.repeat(32);
const original = { tmdb: { ...config.tmdb }, os: { ...config.opensubtitles }, notify: { ...config.notify } };
let dir: string;
let cwd: string;

const req = (path: string, method = 'GET', body?: unknown) =>
  credentialsRoutes.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  // updateEnvVar grava em ./.env: roda dentro de um diretório temporário para nunca tocar o do projeto.
  cwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'cred-'));
  process.chdir(dir);
  Object.assign(config.tmdb, { apiKey: undefined });
  Object.assign(config.opensubtitles, { apiKey: undefined });
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  Object.assign(config.tmdb, original.tmdb);
  Object.assign(config.opensubtitles, original.os);
  Object.assign(config.notify, original.notify);
  setTesterFetchForTests(null);
});

describe('GET /api/credentials', () => {
  test('lista os campos sem nunca devolver o valor de um segredo', async () => {
    config.tmdb.apiKey = TMDB;
    const text = await (await req('/')).text();
    expect(text).not.toContain(TMDB);
    const body = JSON.parse(text) as { fields: Array<{ key: string; configured: boolean; value: string | null; hint: string | null }> };
    const tmdb = body.fields.find((f) => f.key === 'TMDB_API_KEY');
    expect(tmdb).toMatchObject({ configured: true, value: null });
    expect(body.fields.find((f) => f.key === 'OPENSUBTITLES_API_KEY')).toMatchObject({ configured: false, hint: null });
  });

  test('campo não secreto devolve o valor', async () => {
    config.notify.telegramChatId = '-100123';
    const body = (await (await req('/')).json()) as { fields: Array<{ key: string; value: string | null }> };
    expect(body.fields.find((f) => f.key === 'NOTIFY_TELEGRAM_CHAT_ID')?.value).toBe('-100123');
  });

  test('não é cacheável', async () => {
    expect((await req('/')).headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('PUT /api/credentials/:key', () => {
  test('valida, grava no .env com 0600 e aplica em runtime sem ecoar o valor', async () => {
    const res = await req('/TMDB_API_KEY', 'PUT', { value: ` ${TMDB} ` });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(TMDB);
    expect(config.tmdb.apiKey).toBe(TMDB);
    expect(readFileSync('.env', 'utf-8')).toContain(`TMDB_API_KEY=${TMDB}`);
    if (process.platform !== 'win32') expect(statSync('.env').mode & 0o777).toBe(0o600);
  });

  test('valor inválido é recusado sem gravar nem ecoar', async () => {
    const res = await req('/TMDB_API_KEY', 'PUT', { value: 'curta<script>' });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('curta');
    expect(config.tmdb.apiKey).toBeUndefined();
    expect(existsSync('.env')).toBe(false);
  });

  test('chave desconhecida, corpo ruim e valor vazio', async () => {
    expect((await req('/PATH', 'PUT', { value: 'x' })).status).toBe(404);
    expect((await req('/TMDB_API_KEY', 'PUT', { value: 42 })).status).toBe(400);
    expect((await req('/TMDB_API_KEY', 'PUT', { value: '   ' })).status).toBe(400);
  });

  test('URL de aviso só aceita http(s)', async () => {
    expect((await req('/NOTIFY_NTFY_URL', 'PUT', { value: 'file:///etc/passwd' })).status).toBe(400);
    expect((await req('/NOTIFY_NTFY_URL', 'PUT', { value: 'https://ntfy.sh/abc' })).status).toBe(200);
    expect(config.notify.ntfyUrl).toBe('https://ntfy.sh/abc');
  });

  test('quebra de linha no valor não injeta variável no .env', async () => {
    expect((await req('/NOTIFY_TELEGRAM_CHAT_ID', 'PUT', { value: '123\nTMDB_API_KEY=evil' })).status).toBe(400);
  });
});

describe('DELETE /api/credentials/:key', () => {
  test('limpa em runtime e no .env', async () => {
    await req('/TMDB_API_KEY', 'PUT', { value: TMDB });
    const res = await req('/TMDB_API_KEY', 'DELETE');
    expect(res.status).toBe(200);
    expect(config.tmdb.apiKey).toBeUndefined();
    expect(readFileSync('.env', 'utf-8')).not.toContain(TMDB);
  });
});

describe('POST /api/credentials/:key/test', () => {
  test('usa o valor salvo (corpo ignorado) e devolve mensagem fixa', async () => {
    config.tmdb.apiKey = TMDB;
    const seen: string[] = [];
    setTesterFetchForTests(async (url) => {
      seen.push(url);
      return new Response('{}', { status: 200 });
    });
    const res = await req('/TMDB_API_KEY/test', 'POST', { value: 'http://evil.example' });
    expect(await res.json()).toEqual({ ok: true, message: 'TMDB respondeu: chave válida' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toStartWith('https://api.themoviedb.org/3/configuration');
  });

  test('401 vira "recusou" e erro de rede não vaza o segredo', async () => {
    config.tmdb.apiKey = TMDB;
    setTesterFetchForTests(async () => new Response('{}', { status: 401 }));
    expect(await (await req('/TMDB_API_KEY/test', 'POST')).json()).toEqual({ ok: false, message: 'o serviço recusou a credencial' });
    setTesterFetchForTests(async (url) => {
      throw new Error(`falhou ${url}`);
    });
    const text = await (await req('/TMDB_API_KEY/test', 'POST')).text();
    expect(text).not.toContain(TMDB);
  });

  test('não configurada, sem teste e webhook fora do Discord', async () => {
    expect(await (await req('/TMDB_API_KEY/test', 'POST')).json()).toMatchObject({ ok: false });
    config.notify.ntfyUrl = 'https://ntfy.sh/x';
    expect(await (await req('/NOTIFY_NTFY_URL/test', 'POST')).json()).toMatchObject({ ok: false });
    config.notify.discordUrl = 'http://169.254.169.254/latest';
    let called = false;
    setTesterFetchForTests(async () => {
      called = true;
      return new Response('{}');
    });
    expect(await (await req('/NOTIFY_DISCORD_WEBHOOK_URL/test', 'POST')).json()).toMatchObject({ ok: false });
    config.notify.discordUrl = 'http://discord.com/api/webhooks/1/tok';
    expect(await (await req('/NOTIFY_DISCORD_WEBHOOK_URL/test', 'POST')).json()).toMatchObject({ ok: false });
    config.notify.discordUrl = 'https://discord.com/api/v10/users/@me';
    expect(await (await req('/NOTIFY_DISCORD_WEBHOOK_URL/test', 'POST')).json()).toMatchObject({ ok: false });
    expect(called).toBe(false);
  });
});

describe('maskSecret', () => {
  test('mostra os 4 últimos só em valores longos', () => {
    expect(maskSecret(`${'x'.repeat(30)}abcd`)).toBe('••••••••abcd');
    expect(maskSecret('curto')).toBe('••••••••');
  });
});
