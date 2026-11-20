import { childText, findAll, parseXml, type XmlNode } from '../providers/xml/minixml.ts';
import { isSafeLanUrl } from './network.ts';

export interface SsdpHit {
  location: string;
  usn: string;
  st: string;
  server: string;
}

export interface CastDevice {
  /** Identificador estável (UDN ou fallback derivado do host/porta). */
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  host: string;
  location: string;
  controlUrl: string;
}

export interface DidlMeta {
  title: string;
  mediaUrl: string;
  mimeType: string;
  subtitleUrl?: string | null;
  posterUrl?: string | null;
}

export interface DlnaPositionInfo {
  relTimeSeconds: number | null;
  durationSeconds: number | null;
}

export type DlnaTransportState = 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT' | 'UNKNOWN';

export const AV_TRANSPORT_SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1';

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] ?? ch);

/** Extrai cabeçalhos relevantes de uma resposta UDP SSDP (`M-SEARCH`). */
export const parseSsdpResponse = (raw: string): SsdpHit | null => {
  const lines = raw.split(/\r?\n/);
  if (!/^HTTP\/1\.[01]\s+200\b/i.test(lines[0] ?? '')) return null;
  const headers = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const val = line.slice(sep + 1).trim();
    if (val) headers.set(key, val);
  }
  const location = headers.get('location');
  if (!location || !isSafeLanUrl(location)) return null;
  return {
    location,
    usn: headers.get('usn') ?? location,
    st: headers.get('st') ?? '',
    server: headers.get('server') ?? '',
  };
};

/**
 * Lê o XML de descrição UPnP de uma TV e extrai o serviço `AVTransport:1`.
 * Usa `minixml` (já bloqueia DTD/entidades e limita profundidade/nós).
 */
export const parseDeviceDescription = (xml: string, locationUrl: string): CastDevice | null => {
  if (!isSafeLanUrl(locationUrl)) return null;
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return null;
  }

  const devices = findAll(root, 'device');
  const mainDevice = devices[0];
  if (!mainDevice) return null;

  const services = findAll(root, 'service');
  const avTransport = services.find((svc) => childText(svc, 'serviceType')?.toLowerCase() === AV_TRANSPORT_SERVICE.toLowerCase());
  const rawControl = avTransport ? childText(avTransport, 'controlURL') : undefined;
  if (!rawControl) return null;

  let controlUrl: string;
  try {
    controlUrl = new URL(rawControl, locationUrl).toString();
  } catch {
    return null;
  }
  if (!isSafeLanUrl(controlUrl)) return null;

  const parsedLocation = new URL(locationUrl);
  const name = childText(mainDevice, 'friendlyName') || parsedLocation.hostname;
  const manufacturer = childText(mainDevice, 'manufacturer') || '';
  const model = childText(mainDevice, 'modelName') || '';
  const udn = childText(mainDevice, 'UDN') || `${parsedLocation.hostname}:${parsedLocation.port || '80'}`;

  return {
    id: udn,
    name,
    manufacturer,
    model,
    host: parsedLocation.hostname,
    location: locationUrl,
    controlUrl,
  };
};

/** Monta o bloco DIDL-Lite enviado em `CurrentURIMetaData` (título, tipo MIME e legenda opcional). */
export const buildDidlLite = (meta: DidlMeta): string => {
  const title = escapeXml(meta.title || 'Vídeo');
  const mediaUrl = escapeXml(meta.mediaUrl);
  const mime = escapeXml(meta.mimeType || 'video/mp4');
  const protocolInfo = `http-get:*:${mime}:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000`;
  const art = meta.posterUrl ? `<upnp:albumArtURI>${escapeXml(meta.posterUrl)}</upnp:albumArtURI>` : '';
  const sub = meta.subtitleUrl
    ? `<res protocolInfo="http-get:*:text/vtt:*">${escapeXml(meta.subtitleUrl)}</res><sec:CaptionInfoEx sec:type="vtt">${escapeXml(meta.subtitleUrl)}</sec:CaptionInfoEx>`
    : '';
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
    'xmlns:sec="http://www.sec.co.kr/">' +
    `<item id="0" parentID="-1" restricted="1">` +
    `<dc:title>${title}</dc:title>` +
    '<upnp:class>object.item.videoItem.movie</upnp:class>' +
    art +
    `<res protocolInfo="${protocolInfo}">${mediaUrl}</res>` +
    sub +
    '</item></DIDL-Lite>'
  );
};

export const buildSoapEnvelope = (action: string, bodyXml: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
  '<s:Body>' +
  `<u:${action} xmlns:u="${AV_TRANSPORT_SERVICE}">${bodyXml}</u:${action}>` +
  '</s:Body></s:Envelope>';

export const formatDlnaTime = (seconds: number): string => {
  const clamped = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const parseDlnaTime = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'NOT_IMPLEMENTED') return null;
  const match = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(trimmed);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
};

export const parsePositionInfo = (xml: string): DlnaPositionInfo => {
  try {
    const root = parseXml(xml);
    const rel = findAll(root, 'RelTime')[0]?.text;
    const dur = findAll(root, 'TrackDuration')[0]?.text;
    return {
      relTimeSeconds: parseDlnaTime(rel),
      durationSeconds: parseDlnaTime(dur),
    };
  } catch {
    return { relTimeSeconds: null, durationSeconds: null };
  }
};

const KNOWN_STATES = new Set<DlnaTransportState>(['PLAYING', 'PAUSED_PLAYBACK', 'STOPPED', 'TRANSITIONING', 'NO_MEDIA_PRESENT']);

export const parseTransportInfo = (xml: string): DlnaTransportState => {
  try {
    const root = parseXml(xml);
    const state = findAll(root, 'CurrentTransportState')[0]?.text.trim().toUpperCase();
    if (state && KNOWN_STATES.has(state as DlnaTransportState)) return state as DlnaTransportState;
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
};
