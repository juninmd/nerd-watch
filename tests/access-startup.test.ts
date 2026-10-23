import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

// config.ts é lido uma vez por processo: a recusa de partida precisa de um processo novo para ser provada de verdade.
const CONFIG = fileURLToPath(new URL('../src/server/config.ts', import.meta.url));

const importConfig = async (accessToken: string | undefined) => {
  const env: Record<string, string | undefined> = { ...process.env, ACCESS_TOKEN: accessToken };
  if (accessToken === undefined) delete env.ACCESS_TOKEN;
  const proc = Bun.spawn([process.execPath, '-e', `await import(${JSON.stringify(CONFIG)})`], {
    env: env as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
};

describe('partida com ACCESS_TOKEN', () => {
  test('token curto recusa a partida com erro claro e sem ecoar o valor', async () => {
    const short = 'curto-falso-123'; // 15 caracteres
    const { code, stderr } = await importConfig(short);
    expect(code).not.toBe(0);
    expect(stderr).toContain('ACCESS_TOKEN');
    expect(stderr).toContain('16');
    expect(stderr).not.toContain(short);
  });

  test('sem ACCESS_TOKEN o config carrega normalmente', async () => {
    const { code } = await importConfig(undefined);
    expect(code).toBe(0);
  });

  test('token com 16 caracteres ou mais carrega normalmente', async () => {
    const { code } = await importConfig('fake-token-0123456789');
    expect(code).toBe(0);
  });
});
