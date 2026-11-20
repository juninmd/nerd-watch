import { afterEach, describe, expect, test } from 'bun:test';
import { AddonError } from '../../src/server/providers/stremio/client.ts';
import { STATUS_ERROR_TTL_MS, STATUS_TTL_MS, addonStatus, resetAddonStatusCache } from '../../src/server/providers/stremio/status.ts';

/**
 * Cache do "status" do addon: a tela de addons pede isso para cada um ao abrir, e sem cache cada
 * visita refazia um manifest por addon. Aqui se prova TTL, TTL curto para erro e dedupe em voo.
 */

const addon = { id: 'a1', manifestUrl: 'https://addon.example.com/manifest.json' };

afterEach(() => resetAddonStatusCache());

describe('addonStatus', () => {
  test('resposta boa fica em cache pelo TTL e depois é reconsultada', async () => {
    let now = 1_000;
    let calls = 0;
    const check = async () => {
      calls++;
      return { id: 'x' };
    };
    expect(await addonStatus(addon, { now: () => now, check })).toEqual({ ok: true, error: null });
    now += STATUS_TTL_MS - 1;
    await addonStatus(addon, { now: () => now, check });
    expect(calls).toBe(1);

    now += 2;
    await addonStatus(addon, { now: () => now, check });
    expect(calls).toBe(2);
  });

  test('erro é cacheado por pouco tempo (não martela addon fora do ar)', async () => {
    let now = 1_000;
    let calls = 0;
    const check = async (): Promise<unknown> => {
      calls++;
      throw new AddonError('http_status', 'o addon respondeu 500');
    };
    expect(await addonStatus(addon, { now: () => now, check })).toEqual({ ok: false, error: 'o addon respondeu 500' });

    now += STATUS_ERROR_TTL_MS - 1;
    expect((await addonStatus(addon, { now: () => now, check })).ok).toBe(false);
    expect(calls).toBe(1);

    now += 2;
    await addonStatus(addon, { now: () => now, check });
    expect(calls).toBe(2);
    // O TTL de erro é bem menor que o de sucesso.
    expect(STATUS_ERROR_TTL_MS).toBeLessThan(STATUS_TTL_MS);
  });

  test('duas visitas simultâneas compartilham uma requisição', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const check = async () => {
      calls++;
      await gate;
      return { ok: true };
    };
    const first = addonStatus(addon, { check });
    const second = addonStatus(addon, { check });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });

  test('mensagem de erro que não é do addon vira texto fixo', async () => {
    const status = await addonStatus(addon, {
      check: async () => {
        throw new TypeError('boom');
      },
    });
    expect(status).toEqual({ ok: false, error: 'não foi possível verificar o addon' });
  });

  test('addons diferentes não compartilham cache', async () => {
    let calls = 0;
    const check = async () => {
      calls++;
      return {};
    };
    await addonStatus({ id: 'a1', manifestUrl: 'https://a.example.com/manifest.json' }, { check });
    await addonStatus({ id: 'a2', manifestUrl: 'https://b.example.com/manifest.json' }, { check });
    expect(calls).toBe(2);
  });
});
