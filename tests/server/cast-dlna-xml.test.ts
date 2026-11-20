import { describe, expect, test } from 'bun:test';
import {
  buildDidlLite,
  buildSoapEnvelope,
  formatDlnaTime,
  parseDeviceDescription,
  parseDlnaTime,
  parsePositionInfo,
  parseSsdpResponse,
  parseTransportInfo,
} from '../../src/server/cast/dlna-xml.ts';

const SAMPLE_DESC_XML = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>Sala Samsung TV</friendlyName>
    <manufacturer>Samsung Electronics</manufacturer>
    <modelName>UN55AU7700</modelName>
    <UDN>uuid:12345678-1234-1234-1234-123456789abc</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <controlURL>/upnp/control/AVTransport1</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

describe('cast dlna-xml: SSDP', () => {
  test('extrai cabeçalhos de resposta SSDP válida na LAN', () => {
    const raw = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'LOCATION: http://192.168.1.50:9197/dmr',
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
      'USN: uuid:abc::urn:schemas-upnp-org:device:MediaRenderer:1',
      'SERVER: Linux/4.0 UPnP/1.0',
      '',
    ].join('\r\n');
    const hit = parseSsdpResponse(raw);
    expect(hit).toEqual({
      location: 'http://192.168.1.50:9197/dmr',
      usn: 'uuid:abc::urn:schemas-upnp-org:device:MediaRenderer:1',
      st: 'urn:schemas-upnp-org:device:MediaRenderer:1',
      server: 'Linux/4.0 UPnP/1.0',
    });
  });

  test('descarta SSDP com LOCATION fora da LAN (proteção SSRF)', () => {
    const raw = 'HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:7799/api/library\r\n\r\n';
    expect(parseSsdpResponse(raw)).toBeNull();
  });
});

describe('cast dlna-xml: descrição UPnP', () => {
  test('extrai nome, fabricante, modelo e resolve controlURL relativo', () => {
    const dev = parseDeviceDescription(SAMPLE_DESC_XML, 'http://192.168.1.50:9197/dmr/desc.xml');
    expect(dev).toEqual({
      id: 'uuid:12345678-1234-1234-1234-123456789abc',
      name: 'Sala Samsung TV',
      manufacturer: 'Samsung Electronics',
      model: 'UN55AU7700',
      host: '192.168.1.50',
      location: 'http://192.168.1.50:9197/dmr/desc.xml',
      controlUrl: 'http://192.168.1.50:9197/upnp/control/AVTransport1',
    });
  });

  test('recusa XML com DOCTYPE (XXE) e controlURL apontando para fora da LAN', () => {
    const xxe = `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${SAMPLE_DESC_XML}`;
    expect(parseDeviceDescription(xxe, 'http://192.168.1.50:9197/dmr')).toBeNull();

    const evilControl = SAMPLE_DESC_XML.replace('/upnp/control/AVTransport1', 'http://127.0.0.1:7799/evil');
    expect(parseDeviceDescription(evilControl, 'http://192.168.1.50:9197/dmr')).toBeNull();
  });
});

describe('cast dlna-xml: DIDL-Lite, SOAP e tempo', () => {
  test('escapa caracteres especiais no título e inclui legenda quando informada', () => {
    const didl = buildDidlLite({
      title: 'Rick & Morty <S01E01>',
      mediaUrl: 'http://192.168.1.10:5555/s/abc/media',
      mimeType: 'video/mp4',
      subtitleUrl: 'http://192.168.1.10:5555/s/abc/sub.vtt',
    });
    expect(didl).toContain('<dc:title>Rick &amp; Morty &lt;S01E01&gt;</dc:title>');
    expect(didl).toContain('http://192.168.1.10:5555/s/abc/media');
    expect(didl).toContain('CaptionInfoEx');
    expect(didl).toContain('sub.vtt');
  });

  test('monta envelope SOAP para AVTransport:1', () => {
    const soap = buildSoapEnvelope('Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
    expect(soap).toContain('<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">');
    expect(soap).toContain('<Speed>1</Speed>');
  });

  test('formata e lê tempos HH:MM:SS do DLNA', () => {
    expect(formatDlnaTime(0)).toBe('00:00:00');
    expect(formatDlnaTime(3665.9)).toBe('01:01:05');
    expect(parseDlnaTime('01:01:05')).toBe(3665);
    expect(parseDlnaTime('0:05:12.500')).toBe(312);
    expect(parseDlnaTime('NOT_IMPLEMENTED')).toBeNull();
    expect(parseDlnaTime('00:65:00')).toBeNull();
  });

  test('lê respostas de GetPositionInfo e GetTransportInfo', () => {
    const posXml = `<s:Envelope><s:Body><u:GetPositionInfoResponse><TrackDuration>01:30:00</TrackDuration><RelTime>00:12:34</RelTime></u:GetPositionInfoResponse></s:Body></s:Envelope>`;
    expect(parsePositionInfo(posXml)).toEqual({ relTimeSeconds: 754, durationSeconds: 5400 });

    const trXml = `<s:Envelope><s:Body><u:GetTransportInfoResponse><CurrentTransportState>PLAYING</CurrentTransportState></u:GetTransportInfoResponse></s:Body></s:Envelope>`;
    expect(parseTransportInfo(trXml)).toBe('PLAYING');
    expect(parseTransportInfo('<broken')).toBe('UNKNOWN');
  });
});
