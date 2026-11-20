import { describe, expect, test } from 'bun:test';
import { loginPage } from '../../src/server/http/access-page.ts';
import { escapeHtml, oauthCallbackPage } from '../../src/server/http/html.ts';
import { credentialsRoutes } from '../../src/server/routes/credentials.ts';
import { driveRoutes } from '../../src/server/routes/drive.ts';
import { sourcesRoutes } from '../../src/server/routes/sources.ts';

describe('escapeHtml e páginas HTML do servidor', () => {
  test('escapa caracteres especiais de HTML', () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe('&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;');
  });

  test('loginPage escapa mensagem de erro', () => {
    const html = loginPage('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('oauthCallbackPage escapa título e mensagem e desliga cache/referrer', async () => {
    const res = oauthCallbackPage('<b>Título</b>', '<script>alert(1)</script>');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    const html = await res.text();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;Título&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('callbacks OAuth de drive e sources nunca refletem HTML bruto', async () => {
    const driveRes = await driveRoutes.request('/oauth/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(driveRes.status).toBe(200);
    expect(await driveRes.text()).not.toContain('<script>');

    const srcRes = await sourcesRoutes.request('/trakt/oauth/callback?error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    expect(srcRes.status).toBe(200);
    expect(await srcRes.text()).not.toContain('<img');
  });
});

describe('limite de corpo JSON em credentials, drive e sources', () => {
  test('rejeita corpo acima do teto com 413', async () => {
    const huge = JSON.stringify({ value: 'a'.repeat(20 * 1024) });
    const credRes = await credentialsRoutes.request('/TMDB_API_KEY', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: huge,
    });
    expect(credRes.status).toBe(413);

    const driveRes = await driveRoutes.request('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: huge,
    });
    expect(driveRes.status).toBe(413);

    const srcRes = await sourcesRoutes.request('/trakt/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { a: 'x'.repeat(70 * 1024) } }),
    });
    expect(srcRes.status).toBe(413);
  });
});
