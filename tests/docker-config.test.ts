import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (file: string) => Bun.file(join(ROOT, file)).text();

/**
 * Pina as garantias de segurança do empacotamento: o `.env` e os dados do usuário nunca entram na imagem, e a
 * porta publicada fica presa ao loopback do host (o Host/Origin check do servidor continua sendo a barreira real).
 */
describe('Docker packaging', () => {
  test('.dockerignore mantém segredos, dados e lixo de dev fora da imagem', async () => {
    const ignored = (await read('.dockerignore')).split('\n').map((l) => l.trim());
    for (const entry of ['.env', 'data/', 'node_modules/', '.git/', '.claude/']) {
      expect(ignored).toContain(entry);
    }
  });

  test('a imagem roda como usuário não-root e escuta em 0.0.0.0 só dentro do container', async () => {
    const dockerfile = await read('Dockerfile');
    expect(dockerfile).toMatch(/^USER (?!root\b)\S+/m);
    expect(dockerfile).toMatch(/^ENV [\s\S]*?HOST=0\.0\.0\.0/m);
  });

  test('a imagem instala o ffmpeg pelo apt (conversão de formatos), sem baixar binário de fora', async () => {
    const dockerfile = await read('Dockerfile');
    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends ffmpeg/);
    expect(dockerfile).not.toMatch(/curl[^\n]*ffmpeg|wget[^\n]*ffmpeg/);
  });

  test('o HEALTHCHECK usa o endpoint de saúde que já existe', async () => {
    expect(await read('Dockerfile')).toMatch(/HEALTHCHECK[\s\S]*\/api\/health/);
  });

  test('o compose publica a porta somente em 127.0.0.1 do host', async () => {
    const compose = await read('docker-compose.yml');
    expect(compose).toMatch(/"127\.0\.0\.1:7799:7799"/);
    expect(compose).not.toMatch(/- "7799:7799"/);
  });
});
