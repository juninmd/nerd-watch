import { describe, expect, test } from 'bun:test';
import { leadDaysEnv } from '../src/server/config.ts';
import { parseHttpUrl as httpUrlEnv } from '../src/server/notify/url.ts';

describe('NOTIFY_LEAD_DAYS', () => {
  test('ausente ou vazio cai no padrão: avisa só no dia do lançamento', () => {
    expect(leadDaysEnv(undefined)).toBe(0);
    expect(leadDaysEnv('   ')).toBe(0);
  });

  test('aceita o intervalo inteiro de 0 a 7', () => {
    for (const n of [0, 1, 3, 7]) expect(leadDaysEnv(String(n))).toBe(n);
  });

  test('fora do intervalo, fracionário ou lixo volta ao padrão (nunca vira NaN)', () => {
    for (const bad of ['8', '-1', '2.5', 'abc', 'NaN', '1e3']) expect(leadDaysEnv(bad)).toBe(0);
  });
});

describe('URLs de notificação vindas do ambiente', () => {
  test('ausente ou vazia: nenhum sink', () => {
    expect(httpUrlEnv(undefined)).toBeUndefined();
    expect(httpUrlEnv('  ')).toBeUndefined();
  });

  test('aceita http e https e devolve a URL aparada', () => {
    expect(httpUrlEnv(' https://ntfy.sh/topico ')).toBe('https://ntfy.sh/topico');
    expect(httpUrlEnv('http://127.0.0.1:9000/hook')).toBe('http://127.0.0.1:9000/hook');
  });

  test('esquemas que não são http(s) são rejeitados', () => {
    for (const bad of ['file:///etc/hosts', 'ftp://x.test', 'javascript:void(0)', 'data:text/plain,hi', 'sem-esquema']) {
      expect(httpUrlEnv(bad)).toBeUndefined();
    }
  });
});
