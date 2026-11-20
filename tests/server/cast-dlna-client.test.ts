import { describe, expect, test } from 'bun:test';
import { createDlnaClient } from '../../src/server/cast/dlna-client.ts';
import type { CastDevice } from '../../src/server/cast/dlna-xml.ts';

const device: CastDevice = {
  id: 'uuid:tv-1',
  name: 'TV Sala',
  manufacturer: 'Test',
  model: 'M1',
  host: '192.168.1.50',
  location: 'http://192.168.1.50:8080/desc.xml',
  controlUrl: 'http://192.168.1.50:8080/AVTransport/control',
};

describe('createDlnaClient', () => {
  test('cancela corpo em erro HTTP da TV', async () => {
    let cancelled = false;
    const fetcher = (async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 500 },
      )) as unknown as typeof fetch;

    const client = createDlnaClient(fetcher);
    await expect(client.play(device)).rejects.toThrow('HTTP 500');
    expect(cancelled).toBe(true);
  });

  test('rejeita resposta SOAP acima de 256 KB e cancela o stream', async () => {
    let cancelled = false;
    const fetcher = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(128 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const client = createDlnaClient(fetcher);
    await expect(client.play(device)).rejects.toThrow('grande demais');
    expect(cancelled).toBe(true);
  });
});
