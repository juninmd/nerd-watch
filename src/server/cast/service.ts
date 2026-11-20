import QRCode from 'qrcode';
import type { DlnaClient, DlnaStatus } from './dlna-client.ts';
import type { CastDevice } from './dlna-xml.ts';
import { isPrivateLanIpv4, type LanInterface, listLanInterfaces } from './network.ts';
import { type CastRelay, type CastSession, isSafeMediaSrc } from './relay.ts';
import { discoverDlnaDevices } from './ssdp.ts';

export interface CastDeviceDto {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  host: string;
}

export interface CastSessionDto {
  id: string;
  title: string;
  subtitle: string;
  host: string;
  port: number;
  watchUrl: string;
  mediaUrl: string;
  subtitleUrl: string | null;
  qrDataUrl: string;
  device: CastDeviceDto | null;
  createdAt: number;
}

export interface StartCastInput {
  src: string;
  title: string;
  subtitle?: string;
  poster?: string | null;
  mimeType?: string;
  subtitleVtt?: string | null;
  startAt?: number;
  host?: string;
  deviceId?: string;
}

export type CastControlCommand =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'stop' }
  | { action: 'seek'; seconds: number };

export interface CastServiceDeps {
  relay: CastRelay;
  dlna: DlnaClient;
  discover?: () => Promise<CastDevice[]>;
  listInterfaces?: () => LanInterface[];
  toQrDataUrl?: (text: string) => Promise<string>;
}

export interface CastService {
  discover(): Promise<{ interfaces: LanInterface[]; defaultHost: string | null; devices: CastDeviceDto[] }>;
  startSession(input: StartCastInput): Promise<CastSessionDto>;
  getSession(id: string): Promise<{ session: CastSessionDto; playback: DlnaStatus | null } | null>;
  control(id: string, cmd: CastControlCommand): Promise<DlnaStatus | null>;
  stopSession(id: string): Promise<boolean>;
}

const toDeviceDto = (dev: CastDevice): CastDeviceDto => ({
  id: dev.id,
  name: dev.name,
  manufacturer: dev.manufacturer,
  model: dev.model,
  host: dev.host,
});

const defaultQr = (text: string): Promise<string> =>
  QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' });

export const createCastService = (deps: CastServiceDeps): CastService => {
  const listInterfacesFn = deps.listInterfaces ?? (() => listLanInterfaces());
  const discoverFn = deps.discover ?? (() => discoverDlnaDevices({ bindAddresses: listInterfacesFn().map((i) => i.address) }));
  const toQrDataUrl = deps.toQrDataUrl ?? defaultQr;

  /** Cache em memória dos dispositivos descobertos: o cliente manda só `deviceId`, nunca URL arbitrária. */
  const knownDevices = new Map<string, CastDevice>();
  const sessionHost = new Map<string, string>();
  const sessionQr = new Map<string, string>();

  const buildUrls = (host: string, port: number, session: CastSession) => {
    const base = `http://${host}:${port}/s/${session.token}`;
    return {
      watchUrl: `${base}/watch`,
      mediaUrl: `${base}/media`,
      subtitleUrl: session.subtitleVtt ? `${base}/sub.vtt` : null,
      posterUrl: session.poster && isSafeMediaSrc(session.poster) ? `${base}/poster` : null,
    };
  };

  const toSessionDto = async (session: CastSession, host: string, port: number): Promise<CastSessionDto> => {
    const urls = buildUrls(host, port, session);
    let qr = sessionQr.get(session.id);
    if (!qr) {
      qr = await toQrDataUrl(urls.watchUrl);
      sessionQr.set(session.id, qr);
    }
    return {
      id: session.id,
      title: session.title,
      subtitle: session.subtitle,
      host,
      port,
      watchUrl: urls.watchUrl,
      mediaUrl: urls.mediaUrl,
      subtitleUrl: urls.subtitleUrl,
      qrDataUrl: qr,
      device: session.device ? toDeviceDto(session.device) : null,
      createdAt: session.createdAt,
    };
  };

  const pickHost = (requested?: string): string => {
    const interfaces = listInterfacesFn();
    if (requested) {
      const clean = requested.trim();
      if (!isPrivateLanIpv4(clean)) throw new Error('endereço IP fora da rede local');
      return clean;
    }
    const first = interfaces[0]?.address;
    if (!first) throw new Error('nenhuma interface Wi-Fi ou rede local encontrada');
    return first;
  };

  const discover = async () => {
    const interfaces = listInterfacesFn();
    const devices = await discoverFn();
    knownDevices.clear();
    for (const dev of devices) knownDevices.set(dev.id, dev);
    return {
      interfaces,
      defaultHost: interfaces[0]?.address ?? null,
      devices: devices.map(toDeviceDto),
    };
  };

  const startSession = async (input: StartCastInput): Promise<CastSessionDto> => {
    const host = pickHost(input.host);
    let device: CastDevice | null = null;
    if (input.deviceId) {
      device = knownDevices.get(input.deviceId) ?? null;
      if (!device) throw new Error('TV não encontrada — clique em buscar novamente');
    }

    const session = deps.relay.createSession({
      mediaSrc: input.src,
      title: input.title,
      subtitle: input.subtitle,
      poster: input.poster,
      mimeType: input.mimeType,
      subtitleVtt: input.subtitleVtt,
      startAt: input.startAt,
      device,
    });
    const port = deps.relay.ensureStarted();
    sessionHost.set(session.id, host);

    if (device) {
      const urls = buildUrls(host, port, session);
      try {
        await deps.dlna.loadAndPlay(
          device,
          {
            title: session.title,
            mediaUrl: urls.mediaUrl,
            mimeType: session.mimeType,
            subtitleUrl: urls.subtitleUrl,
            posterUrl: urls.posterUrl,
          },
          session.startAt,
        );
      } catch (err) {
        deps.relay.removeSession(session.id);
        sessionHost.delete(session.id);
        sessionQr.delete(session.id);
        throw err;
      }
    }

    return toSessionDto(session, host, port);
  };

  const getSession = async (id: string) => {
    const session = deps.relay.getSession(id);
    const port = deps.relay.port();
    if (!session || !port) return null;
    const host = sessionHost.get(id) ?? listInterfacesFn()[0]?.address ?? '127.0.0.1';
    const dto = await toSessionDto(session, host, port);
    const playback = session.device ? await deps.dlna.status(session.device) : null;
    return { session: dto, playback };
  };

  const control = async (id: string, cmd: CastControlCommand): Promise<DlnaStatus | null> => {
    const session = deps.relay.getSession(id);
    if (!session) throw new Error('sessão de transmissão não encontrada');
    if (!session.device) throw new Error('esta sessão não está ligada a uma TV DLNA');

    if (cmd.action === 'play') await deps.dlna.play(session.device);
    else if (cmd.action === 'pause') await deps.dlna.pause(session.device);
    else if (cmd.action === 'stop') await deps.dlna.stop(session.device);
    else if (cmd.action === 'seek') await deps.dlna.seek(session.device, cmd.seconds);

    return deps.dlna.status(session.device).catch(() => null);
  };

  const stopSession = async (id: string): Promise<boolean> => {
    const session = deps.relay.getSession(id);
    if (!session) return false;
    if (session.device) {
      try {
        await deps.dlna.stop(session.device);
      } catch {
        // TV pode já ter sido desligada ou trocado de entrada.
      }
    }
    sessionHost.delete(id);
    sessionQr.delete(id);
    return deps.relay.removeSession(id);
  };

  return { discover, startSession, getSession, control, stopSession };
};
