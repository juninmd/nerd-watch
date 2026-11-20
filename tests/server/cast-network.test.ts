import { describe, expect, test } from 'bun:test';
import { isPrivateLanIpv4, isSafeLanUrl, rankInterface } from '../../src/server/cast/network.ts';
import { discoverDlnaDevices } from '../../src/server/cast/ssdp.ts';

describe('cast network: isPrivateLanIpv4', () => {
  test('aceita faixas privadas RFC1918', () => {
    expect(isPrivateLanIpv4('192.168.0.1')).toBe(true);
    expect(isPrivateLanIpv4('192.168.15.42')).toBe(true);
    expect(isPrivateLanIpv4('10.0.0.5')).toBe(true);
    expect(isPrivateLanIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateLanIpv4('172.31.255.254')).toBe(true);
  });

  test('recusa loopback, metadata de nuvem, públicos e inválidos', () => {
    expect(isPrivateLanIpv4('127.0.0.1')).toBe(false);
    expect(isPrivateLanIpv4('169.254.169.254')).toBe(false);
    expect(isPrivateLanIpv4('172.15.0.1')).toBe(false);
    expect(isPrivateLanIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateLanIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateLanIpv4('192.168.1.256')).toBe(false);
    expect(isPrivateLanIpv4('localhost')).toBe(false);
    expect(isPrivateLanIpv4('')).toBe(false);
  });
});

describe('cast network: isSafeLanUrl', () => {
  test('aceita HTTP em IP privado da LAN', () => {
    expect(isSafeLanUrl('http://192.168.1.20:8008/ssdp/device-desc.xml')).toBe(true);
    expect(isSafeLanUrl('http://10.0.0.12:1400/MediaRenderer/AVTransport/Control')).toBe(true);
  });

  test('bloqueia SSRF (loopback, metadata, público, credenciais e esquemas não HTTP)', () => {
    expect(isSafeLanUrl('http://127.0.0.1:7799/api/health')).toBe(false);
    expect(isSafeLanUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafeLanUrl('http://example.com/desc.xml')).toBe(false);
    expect(isSafeLanUrl('https://192.168.1.20/desc.xml')).toBe(false);
    expect(isSafeLanUrl('http://user:pass@192.168.1.20/desc.xml')).toBe(false);
    expect(isSafeLanUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeLanUrl('not-a-url')).toBe(false);
  });
});

describe('cast network: rankInterface', () => {
  test('prefere Wi-Fi/Ethernet 192.168 acima de adaptadores virtuais', () => {
    const wifi = rankInterface('Wi-Fi', '192.168.1.15');
    const docker = rankInterface('vEthernet (WSL)', '172.24.16.1');
    const tailscale = rankInterface('tailscale0', '10.0.0.5');
    expect(wifi).toBeGreaterThan(docker);
    expect(wifi).toBeGreaterThan(tailscale);
  });
});

describe('cast ssdp: discoverDlnaDevices', () => {
  test('não falha quando o endereço de bind é inválido ou não há respostas no timeout', async () => {
    const devices = await discoverDlnaDevices({ timeoutMs: 80, bindAddresses: ['203.0.113.1'] });
    expect(Array.isArray(devices)).toBe(true);
  });
});
