import serverDef from '../src/server/index.ts';

const PORT = 7898;
const BASE = `http://127.0.0.1:${PORT}`;

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: serverDef.fetch,
});

let ok = true;
const fail = (msg: string) => {
  ok = false;
  console.error(`✗ ${msg}`);
};

try {

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  if (health.ok) console.log('✓ /api/health');
  else fail('/api/health não retornou ok');

  const forbidden = await fetch(`${BASE}/api/health`, { headers: { Host: 'evil.example.com' } });
  if (forbidden.status === 403) console.log('✓ host não-loopback bloqueado (403)');
  else fail(`host não-loopback deveria ser 403, veio ${forbidden.status}`);

  const csrf = await fetch(`${BASE}/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://attacker.example.com' },
    body: JSON.stringify({}),
  });
  if (csrf.status === 403) console.log('✓ CSRF com origem externa bloqueado (403)');
  else fail(`CSRF com origem externa deveria ser 403, veio ${csrf.status}`);

  const searchMissing = await fetch(`${BASE}/api/search`);
  if (searchMissing.status === 400) console.log('✓ /api/search sem "q" rejeitado (400)');
  else fail(`/api/search sem "q" deveria ser 400, veio ${searchMissing.status}`);

  const searchRes = await fetch(`${BASE}/api/search?q=living+dead`).then((r) => r.json());
  if (Array.isArray(searchRes.results)) console.log(`✓ /api/search (${searchRes.results.length} resultados)`);
  else fail('/api/search formato inesperado');

  const createLib = await fetch(`${BASE}/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'archive',
      sourceId: 'smoke-test-title',
      mediaType: 'movie',
      title: 'Smoke Test Movie',
      watchStatus: 'want',
    }),
  });
  if (createLib.status === 201) console.log('✓ POST /api/library cria entrada (201)');
  else fail(`POST /api/library deveria ser 201, veio ${createLib.status}`);

  const libItem = await createLib.json();
  const titleId = libItem.titleId ?? libItem.title_id ?? libItem.id;

  const patchLib = await fetch(`${BASE}/api/library/${titleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watchStatus: 'watched', rating: 10, notes: 'Homologado' }),
  });
  if (patchLib.ok) console.log('✓ PATCH /api/library/:id atualiza entrada');
  else fail(`PATCH /api/library falhou: ${patchLib.status}`);

  const lib = await fetch(`${BASE}/api/library`).then((r) => r.json());
  if (Array.isArray(lib.items) && lib.items.some((it: { title?: { title?: string }; id?: string }) => it.title?.title === 'Smoke Test Movie' || it.id === libItem.id)) {
    console.log('✓ GET /api/library lista item criado');
  } else {
    fail('/api/library formato inesperado ou item não encontrado');
  }

  const cal = await fetch(`${BASE}/api/calendar?days=30`).then((r) => r.json());
  if (Array.isArray(cal.entries)) console.log('✓ GET /api/calendar');
  else fail('/api/calendar formato inesperado');

  const backupData = await fetch(`${BASE}/api/backup`).then((r) => r.json());
  if (backupData.version && Array.isArray(backupData.titles)) console.log('✓ GET /api/backup exporta dados');
  else fail('/api/backup export formato inesperado');

  const importRes = await fetch(`${BASE}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(backupData),
  });
  if (importRes.ok) console.log('✓ POST /api/backup/import importa backup');
  else fail(`POST /api/backup/import falhou: ${importRes.status}`);

  const deleteLib = await fetch(`${BASE}/api/library/${libItem.id}`, { method: 'DELETE' });
  if (deleteLib.status === 204) console.log('✓ DELETE /api/library/:id remove entrada (204)');
  else fail(`DELETE /api/library/:id deveria ser 204, veio ${deleteLib.status}`);

  const tgSettings = await fetch(`${BASE}/api/telegram/settings`).then((r) => r.json());
  if (typeof tgSettings.botTokenConfigured === 'boolean') console.log('✓ GET /api/telegram/settings');
  else fail('/api/telegram/settings formato inesperado');

  const tgChannels = await fetch(`${BASE}/api/telegram/channels`).then((r) => r.json());
  if (Array.isArray(tgChannels.channels)) console.log('✓ GET /api/telegram/channels');
  else fail('/api/telegram/channels formato inesperado');

  const subRes = await fetch(`${BASE}/api/subtitles?imdbId=tt0111161&mediaType=movie`).then((r) => r.json());
  if (typeof subRes.enabled === 'boolean' && Array.isArray(subRes.results)) console.log('✓ GET /api/subtitles status');
  else fail('/api/subtitles formato inesperado');

  const home = await fetch(`${BASE}/`);
  if (home.ok && (await home.text()).includes('<div id="app">')) console.log('✓ / serve o index.html');
  else fail('/ não serviu o index.html esperado');

  const appJs = await fetch(`${BASE}/app.js`);
  if (appJs.ok && appJs.headers.get('content-type')?.includes('javascript')) console.log('✓ /app.js servido');
  else fail('/app.js falhou ao ser servido');

  const css = await fetch(`${BASE}/styles.css`);
  if (css.ok && css.headers.get('content-type')?.includes('text/css')) console.log('✓ /styles.css servido');
  else fail('/styles.css falhou ao ser servido');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  server.stop(true);
}

if (!ok) {
  console.error('smoke test falhou');
  process.exit(1);
}
console.log('smoke test ok');
