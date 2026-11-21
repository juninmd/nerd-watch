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

  /** Fake de TV: fica TRANSITIONING nas primeiras consultas e só aceita Seek depois de PLAYING. */
  const transitioningTv = (busyPolls: number) => {
    const calls: string[] = [];
    let polls = 0;
    let seekTarget: string | null = null;
    const fetcher = (async (_url: string, init: RequestInit) => {
      const action = String((init.headers as Record<string, string>).SOAPACTION).split('#')[1]?.replace('"', '') ?? '';
      calls.push(action);
      if (action === 'GetTransportInfo') {
        const state = polls++ < busyPolls ? 'TRANSITIONING' : 'PLAYING';
        return new Response(
          `<s:Envelope><s:Body><u:GetTransportInfoResponse><CurrentTransportState>${state}</CurrentTransportState></u:GetTransportInfoResponse></s:Body></s:Envelope>`,
        );
      }
      if (action === 'Seek') {
        if (polls <= busyPolls) return new Response('', { status: 500 });
        seekTarget = /<Target>([^<]+)<\/Target>/.exec(String(init.body))?.[1] ?? null;
      }
      return new Response('');
    }) as unknown as typeof fetch;
    return { fetcher, calls, seek: () => seekTarget };
  };

  test('retoma no ponto pausado: espera a TV sair de TRANSITIONING antes do Seek', async () => {
    const tv = transitioningTv(2);
    const client = createDlnaClient(tv.fetcher, async () => {});
    await client.loadAndPlay(device, { title: 'X', mediaUrl: 'http://192.168.1.10:9000/m', mimeType: 'video/mp4' }, 102);
    expect(tv.seek()).toBe('00:01:42');
    expect(tv.calls.indexOf('Seek')).toBeGreaterThan(tv.calls.indexOf('Play'));
  });

  test('desiste do Seek sem falhar quando a TV nunca fica pronta', async () => {
    const tv = transitioningTv(1000);
    const client = createDlnaClient(tv.fetcher, async () => {});
    await client.loadAndPlay(device, { title: 'X', mediaUrl: 'http://192.168.1.10:9000/m', mimeType: 'video/mp4' }, 102);
    expect(tv.seek()).toBeNull();
    expect(tv.calls.filter((c) => c === 'GetTransportInfo').length).toBeLessThanOrEqual(12);
  });

  test('começo do vídeo (startAt <= 2s) não manda Seek', async () => {
    const tv = transitioningTv(0);
    const client = createDlnaClient(tv.fetcher, async () => {});
    await client.loadAndPlay(device, { title: 'X', mediaUrl: 'http://192.168.1.10:9000/m', mimeType: 'video/mp4' }, 1);
    expect(tv.calls).not.toContain('Seek');
  });
});
