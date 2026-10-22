import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/server/config.ts';
import { streamDriveFile } from '../src/server/providers/drive/api.ts';
import { resetDriveAuthForTests, setDriveFetchForTests } from '../src/server/providers/drive/oauth.ts';
import { streamDropboxFile } from '../src/server/providers/dropbox/api.ts';
import { dropboxOAuth } from '../src/server/providers/dropbox/oauth.ts';
import { streamOneDriveFile } from '../src/server/providers/onedrive/api.ts';
import { onedriveOAuth } from '../src/server/providers/onedrive/oauth.ts';
import { setPlainFetchForTests } from '../src/server/providers/sources/http.ts';
import { fakeService, json } from './support/fake-service.ts';

/**
 * Um vídeo leva minutos para transmitir: `AbortSignal.timeout` no pedido de mídia também aborta a leitura do
 * corpo (o stream morre no 30º segundo). O teto de tempo só pode valer até os cabeçalhos.
 */
const realTimeout = AbortSignal.timeout;
const timeoutSignals = new Set<AbortSignal>();

beforeEach(() => {
  timeoutSignals.clear();
  AbortSignal.timeout = (ms: number) => {
    const signal = realTimeout.call(AbortSignal, ms);
    timeoutSignals.add(signal);
    return signal;
  };
});

afterEach(() => {
  AbortSignal.timeout = realTimeout;
  setPlainFetchForTests();
  setDriveFetchForTests();
  dropboxOAuth.setFetchForTests();
  onedriveOAuth.setFetchForTests();
  delete process.env.DROPBOX_APP_KEY;
  delete process.env.DROPBOX_REFRESH_TOKEN;
  delete process.env.ONEDRIVE_CLIENT_ID;
  delete process.env.ONEDRIVE_REFRESH_TOKEN;
});

const media = () => new Response('x', { status: 206, headers: { 'Content-Range': 'bytes 0-0/9', 'Content-Type': 'video/mp4' } });

describe('pedido de mídia não usa AbortSignal.timeout', () => {
  test('Dropbox', async () => {
    process.env.DROPBOX_APP_KEY = 'appkey123';
    process.env.DROPBOX_REFRESH_TOKEN = 'ref-0';
    dropboxOAuth.resetForTests();
    dropboxOAuth.setFetchForTests(
      fakeService((call) => (call.url.endsWith('/oauth2/token') ? json({ access_token: 'a', expires_in: 14400 }) : json({ link: 'https://dl.example/x' }))).fn,
    );
    let signal: AbortSignal | null | undefined;
    setPlainFetchForTests(async (_url, init) => {
      signal = init?.signal;
      return media();
    });
    await streamDropboxFile('id:AAAAAAAAAAAAAAAAAAAAAN', 'bytes=0-0');
    expect(signal).toBeTruthy();
    expect(timeoutSignals.has(signal as AbortSignal)).toBe(false);
  });

  test('OneDrive', async () => {
    process.env.ONEDRIVE_CLIENT_ID = 'cid-1234';
    process.env.ONEDRIVE_REFRESH_TOKEN = 'ref-0';
    onedriveOAuth.resetForTests();
    onedriveOAuth.setFetchForTests(
      fakeService((call) =>
        call.url.includes('/oauth2/v2.0/token')
          ? json({ access_token: 'a', expires_in: 3600, refresh_token: 'ref-0' })
          : json({ id: 'x', '@microsoft.graph.downloadUrl': 'https://dl.example/x' }),
      ).fn,
    );
    let signal: AbortSignal | null | undefined;
    setPlainFetchForTests(async (_url, init) => {
      signal = init?.signal;
      return media();
    });
    await streamOneDriveFile('01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K', 'bytes=0-0');
    expect(signal).toBeTruthy();
    expect(timeoutSignals.has(signal as AbortSignal)).toBe(false);
  });

  test('Google Drive', async () => {
    const original = { ...config.drive };
    Object.assign(config.drive, { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-123', refreshToken: 'ref' });
    resetDriveAuthForTests();
    let signal: AbortSignal | null | undefined;
    setDriveFetchForTests(async (url, init) => {
      if (String(url).includes('/token')) return json({ access_token: 'acc-1', expires_in: 3600 });
      signal = init?.signal;
      return media();
    });
    try {
      await streamDriveFile('file-a-0000001', 'bytes=0-0');
    } finally {
      Object.assign(config.drive, original);
    }
    expect(signal).toBeTruthy();
    expect(timeoutSignals.has(signal as AbortSignal)).toBe(false);
  });
});
