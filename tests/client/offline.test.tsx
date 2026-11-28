import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfflineBanner } from '../../src/client/app/route-fallback.tsx';
import { OFFLINE_HTML } from '../../src/client/pwa/shell-cache.ts';

describe('tela offline', () => {
  test('a reserva do service worker é HTML estático, sem script', () => {
    expect(OFFLINE_HTML).toStartWith('<!doctype html>');
    expect(OFFLINE_HTML).toContain('sem internet');
    expect(OFFLINE_HTML).not.toContain('<script');
  });

  test('com rede, a faixa offline não aparece', () => {
    expect(renderToStaticMarkup(<OfflineBanner />)).toBe('');
  });
});
