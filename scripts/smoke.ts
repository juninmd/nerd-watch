import { spawn } from 'node:child_process';

const PORT = 7898;
const BASE = `http://127.0.0.1:${PORT}`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn('bun', ['src/server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: ':memory:' },
  stdio: 'pipe',
});

let ok = true;
const fail = (msg: string) => {
  ok = false;
  console.error(`✗ ${msg}`);
};

try {
  for (let i = 0; i < 40; i++) {
    await wait(150);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* servidor ainda subindo */
    }
    if (i === 39) throw new Error('servidor não respondeu a tempo');
  }

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  if (health.ok) console.log('✓ /api/health');
  else fail('/api/health não retornou ok');

  const lib = await fetch(`${BASE}/api/library`).then((r) => r.json());
  if (Array.isArray(lib.items)) console.log('✓ /api/library');
  else fail('/api/library formato inesperado');

  const cal = await fetch(`${BASE}/api/calendar`).then((r) => r.json());
  if (Array.isArray(cal.entries)) console.log('✓ /api/calendar');
  else fail('/api/calendar formato inesperado');

  const forbidden = await fetch(`${BASE}/api/health`, { headers: { Host: 'evil.example.com' } });
  if (forbidden.status === 403) console.log('✓ host não-loopback bloqueado (403)');
  else fail(`host não-loopback deveria ser 403, veio ${forbidden.status}`);

  const home = await fetch(`${BASE}/`);
  if (home.ok && (await home.text()).includes('<div id="app">')) console.log('✓ / serve o client');
  else fail('/ não serviu o index.html esperado');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  server.kill();
}

if (!ok) {
  console.error('smoke test falhou');
  process.exit(1);
}
console.log('smoke test ok');
