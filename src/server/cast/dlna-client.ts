import {
  AV_TRANSPORT_SERVICE,
  buildDidlLite,
  buildSoapEnvelope,
  type CastDevice,
  type DidlMeta,
  type DlnaPositionInfo,
  type DlnaTransportState,
  escapeXml,
  formatDlnaTime,
  parsePositionInfo,
  parseTransportInfo,
} from './dlna-xml.ts';
import { isSafeLanUrl } from './network.ts';

const SOAP_TIMEOUT_MS = 5000;
const MAX_SOAP_BYTES = 256 * 1024;

const readCappedText = async (res: Response, maxBytes: number): Promise<string> => {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('resposta SOAP grande demais');
  }
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('resposta SOAP grande demais');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

export interface DlnaStatus {
  state: DlnaTransportState;
  positionSeconds: number | null;
  durationSeconds: number | null;
}

export interface DlnaClient {
  loadAndPlay(device: CastDevice, meta: DidlMeta, startAt?: number): Promise<void>;
  play(device: CastDevice): Promise<void>;
  pause(device: CastDevice): Promise<void>;
  stop(device: CastDevice): Promise<void>;
  seek(device: CastDevice, seconds: number): Promise<void>;
  status(device: CastDevice): Promise<DlnaStatus>;
}

const sendSoapAction = async (
  controlUrl: string,
  action: string,
  bodyXml: string,
  fetcher: typeof fetch,
): Promise<string> => {
  if (!isSafeLanUrl(controlUrl)) throw new Error('URL de controle da TV fora da rede local');
  const envelope = buildSoapEnvelope(action, bodyXml);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOAP_TIMEOUT_MS);
  try {
    const res = await fetcher(controlUrl, {
      method: 'POST',
      signal: ctrl.signal,
      redirect: 'error',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${AV_TRANSPORT_SERVICE}#${action}"`,
      },
      body: envelope,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`TV recusou comando ${action} (HTTP ${res.status})`);
    }
    return await readCappedText(res, MAX_SOAP_BYTES);
  } finally {
    clearTimeout(timer);
  }
};

export const createDlnaClient = (fetcher: typeof fetch = fetch): DlnaClient => {
  const play = async (device: CastDevice): Promise<void> => {
    await sendSoapAction(device.controlUrl, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>', fetcher);
  };

  const pause = async (device: CastDevice): Promise<void> => {
    await sendSoapAction(device.controlUrl, 'Pause', '<InstanceID>0</InstanceID>', fetcher);
  };

  const stop = async (device: CastDevice): Promise<void> => {
    await sendSoapAction(device.controlUrl, 'Stop', '<InstanceID>0</InstanceID>', fetcher);
  };

  const seek = async (device: CastDevice, seconds: number): Promise<void> => {
    const target = formatDlnaTime(seconds);
    await sendSoapAction(
      device.controlUrl,
      'Seek',
      `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${target}</Target>`,
      fetcher,
    );
  };

  const loadAndPlay = async (device: CastDevice, meta: DidlMeta, startAt?: number): Promise<void> => {
    // Algumas TVs ignoram SetAVTransportURI enquanto outra mídia está tocando; Stop prévio é best-effort.
    try {
      await stop(device);
    } catch {
      // Segue mesmo se a TV já estava parada.
    }
    const didl = buildDidlLite(meta);
    await sendSoapAction(
      device.controlUrl,
      'SetAVTransportURI',
      `<InstanceID>0</InstanceID>` +
        `<CurrentURI>${escapeXml(meta.mediaUrl)}</CurrentURI>` +
        `<CurrentURIMetaData>${escapeXml(didl)}</CurrentURIMetaData>`,
      fetcher,
    );
    await play(device);
    if (startAt && startAt > 2) {
      try {
        await seek(device, startAt);
      } catch {
        // Nem toda TV aceita Seek imediato antes do buffer inicial; o vídeo segue tocando do começo.
      }
    }
  };

  const status = async (device: CastDevice): Promise<DlnaStatus> => {
    const [transportXml, positionXml] = await Promise.all([
      sendSoapAction(device.controlUrl, 'GetTransportInfo', '<InstanceID>0</InstanceID>', fetcher).catch(() => ''),
      sendSoapAction(device.controlUrl, 'GetPositionInfo', '<InstanceID>0</InstanceID>', fetcher).catch(() => ''),
    ]);
    const pos: DlnaPositionInfo = positionXml ? parsePositionInfo(positionXml) : { relTimeSeconds: null, durationSeconds: null };
    return {
      state: transportXml ? parseTransportInfo(transportXml) : 'UNKNOWN',
      positionSeconds: pos.relTimeSeconds,
      durationSeconds: pos.durationSeconds,
    };
  };

  return { loadAndPlay, play, pause, stop, seek, status };
};
