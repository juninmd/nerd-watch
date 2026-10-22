import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/server/config.ts';
import {
  DriveFolderNotFoundError,
  downloadDriveThumb,
  driveMessageId,
  getFolderName,
  listFolderVideos,
  parseFolderInput,
  streamDriveFile,
  toItems,
} from '../src/server/providers/drive/api.ts';
import { DriveReauthRequiredError, resetDriveAuthForTests, setDriveFetchForTests } from '../src/server/providers/drive/oauth.ts';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123';
const original = { ...config.drive };

beforeEach(() => {
  resetDriveAuthForTests();
  Object.assign(config.drive, { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-123', refreshToken: 'ref' });
});

afterEach(() => {
  setDriveFetchForTests();
  Object.assign(config.drive, original);
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const isToken = (url: URL | string | Request): boolean => String(url).includes('/token');
const tokenOk = () => json({ access_token: 'acc-1', expires_in: 3600 });

describe('parseFolderInput', () => {
  test.each([
    [ID, ID],
    [`https://drive.google.com/drive/folders/${ID}`, ID],
    [`https://drive.google.com/drive/u/0/folders/${ID}?usp=sharing`, ID],
    [`https://drive.google.com/open?id=${ID}`, ID],
    [`  ${ID}  `, ID],
  ])('aceita %s', (input, expected) => {
    expect(parseFolderInput(input)).toBe(expected);
  });

  test.each([
    '',
    'curto',
    `http://drive.google.com/drive/folders/${ID}`,
    `https://evil.example/drive/folders/${ID}`,
    `https://drive.google.com.evil.example/drive/folders/${ID}`,
    "x' or 'a'='a",
    `${ID}' in parents or '1`,
  ])('rejeita %s', (input) => {
    expect(parseFolderInput(input)).toBeNull();
  });
});

describe('driveMessageId / toItems', () => {
  test('cresce com a data de criação e é estável para o mesmo arquivo', () => {
    const older = driveMessageId({ id: 'file-a-0000001', createdTime: '2026-01-01T00:00:00.000Z' });
    const newer = driveMessageId({ id: 'file-b-0000002', createdTime: '2026-02-01T00:00:00.000Z' });
    expect(Number(newer)).toBeGreaterThan(Number(older));
    expect(driveMessageId({ id: 'file-a-0000001', createdTime: '2026-01-01T00:00:00.000Z' })).toBe(older);
    expect(Number.isSafeInteger(Number(newer))).toBe(true);
  });

  test('monta o item: título sem extensão, duração em segundos e ID do arquivo como referência', () => {
    const [item] = toItems([
      { id: 'file-a-0000001', name: 'Bleach - 09.mkv', mimeType: 'video/x-matroska', createdTime: '2026-10-19T12:00:00.000Z', videoMediaMetadata: { durationMillis: '1634794' }, thumbnailLink: 'https://lh3.googleusercontent.com/x=s220' },
    ]);
    expect(item).toMatchObject({ caption: 'Bleach - 09', durationSeconds: 1635, fileRef: 'file-a-0000001', postedAt: '2026-10-19T12:00:00.000Z' });
  });

  test('sem metadados de vídeo a duração é nula', () => {
    expect(toItems([{ id: 'file-a-0000001', name: 'x.mp4', mimeType: 'video/mp4' }])[0]?.durationSeconds).toBeNull();
  });
});

describe('listagem', () => {
  test('pagina, filtra vídeos da pasta e manda o token só no cabeçalho', async () => {
    const urls: string[] = [];
    setDriveFetchForTests(async (url, init) => {
      if (isToken(url)) return tokenOk();
      urls.push(String(url));
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer acc-1');
      const second = String(url).includes('pageToken=p2');
      return json(second ? { files: [{ id: 'b', name: 'b.mp4', mimeType: 'video/mp4' }] } : { files: [{ id: 'a', name: 'a.mp4', mimeType: 'video/mp4' }], nextPageToken: 'p2' });
    });
    const files = await listFolderVideos(ID);
    expect(files.map((f) => f.id)).toEqual(['a', 'b']);
    const q = new URL(urls[0] ?? '').searchParams.get('q');
    expect(q).toBe(`'${ID}' in parents and trashed = false and mimeType contains 'video/'`);
    expect(urls.join()).not.toContain('acc-1');
  });

  test('403/404 viram "pasta não encontrada"; não-pasta também', async () => {
    setDriveFetchForTests(async (url) => (isToken(url) ? tokenOk() : json({}, 404)));
    await expect(listFolderVideos(ID)).rejects.toBeInstanceOf(DriveFolderNotFoundError);
    setDriveFetchForTests(async (url) => (isToken(url) ? tokenOk() : json({ id: ID, name: 'arquivo.txt', mimeType: 'text/plain' })));
    await expect(getFolderName(ID)).rejects.toBeInstanceOf(DriveFolderNotFoundError);
  });

  test('um 401 renova o token e tenta de novo uma vez', async () => {
    let tokens = 0;
    let calls = 0;
    setDriveFetchForTests(async (url) => {
      if (isToken(url)) return json({ access_token: `acc-${++tokens}`, expires_in: 3600 });
      calls++;
      return calls === 1 ? json({}, 401) : json({ id: ID, name: 'Minha pasta', mimeType: 'application/vnd.google-apps.folder' });
    });
    expect(await getFolderName(ID)).toBe('Minha pasta');
    expect(tokens).toBe(2);
  });
});

describe('streamDriveFile', () => {
  test('repassa o Range ao Drive e devolve 206 com os cabeçalhos de posição, sem o token', async () => {
    const seenHeaders: Headers[] = [];
    const seenUrls: string[] = [];
    setDriveFetchForTests(async (url, init) => {
      if (isToken(url)) return tokenOk();
      seenHeaders.push(new Headers(init?.headers));
      seenUrls.push(String(url));
      return new Response('abc', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 10-12/1000', 'Content-Length': '3' } });
    });
    const res = await streamDriveFile('file-a-0000001', 'bytes=10-12');
    expect(res.status).toBe(206);
    expect(seenHeaders[0]?.get('Range')).toBe('bytes=10-12');
    expect(seenUrls[0]).toContain('/files/file-a-0000001');
    expect(seenUrls[0]).toContain('alt=media');
    expect(res.headers.get('Content-Range')).toBe('bytes 10-12/1000');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect([...res.headers.values()].join(' ')).not.toContain('acc-1');
    expect(await res.text()).toBe('abc');
  });

  test('404 do Drive vira 404; erro de servidor vira 502 sem vazar o corpo do Google', async () => {
    setDriveFetchForTests(async (url) => (isToken(url) ? tokenOk() : new Response('segredo interno', { status: 404 })));
    expect((await streamDriveFile('file-a-0000001', undefined)).status).toBe(404);
    setDriveFetchForTests(async (url) => (isToken(url) ? tokenOk() : new Response('segredo interno', { status: 500 })));
    const res = await streamDriveFile('file-a-0000001', undefined);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('segredo interno');
  });

  test('401 persistente exige reconectar', async () => {
    setDriveFetchForTests(async (url) => (isToken(url) ? tokenOk() : new Response('', { status: 401 })));
    await expect(streamDriveFile('file-a-0000001', undefined)).rejects.toBeInstanceOf(DriveReauthRequiredError);
  });
});

describe('downloadDriveThumb', () => {
  test('não manda o token para um host que não é do Google', async () => {
    let calls = 0;
    setDriveFetchForTests(async () => {
      calls++;
      return tokenOk();
    });
    expect(await downloadDriveThumb('https://evil.example/thumb=s220')).toBeNull();
    expect(await downloadDriveThumb('http://lh3.googleusercontent.com/thumb=s220')).toBeNull();
    expect(await downloadDriveThumb('não é url')).toBeNull();
    expect(calls).toBe(0);
  });

  test('baixa de googleusercontent com o token e pede um tamanho maior', async () => {
    const requested: string[] = [];
    setDriveFetchForTests(async (url) => {
      if (isToken(url)) return tokenOk();
      requested.push(String(url));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const bytes = await downloadDriveThumb('https://lh3.googleusercontent.com/drive-storage/abc=s220');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(requested[0]).toEndWith('=s480');
  });
});
