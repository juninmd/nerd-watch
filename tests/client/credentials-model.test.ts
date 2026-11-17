import { describe, expect, test } from 'bun:test';
import type { CredentialDto } from '../../src/client/api/credentials.ts';
import { credentialStatus, groupCredentials } from '../../src/client/credentials/credentials-model.ts';

const f = (over: Partial<CredentialDto>): CredentialDto => ({
  key: 'K', label: 'L', group: 'catalog', secret: true, help: '', placeholder: '', restart: false, testable: false, configured: false, value: null, hint: null, ...over,
});
const labels = { catalog: 'Catálogo', telegram: 'Telegram', drive: 'Drive', notify: 'Avisos' };

describe('groupCredentials', () => {
  test('agrupa na ordem de chegada e omite grupos vazios', () => {
    const out = groupCredentials([f({ key: 'A' }), f({ key: 'B', group: 'notify' }), f({ key: 'C' })], labels);
    expect(out.map((s) => [s.id, s.fields.map((x) => x.key)])).toEqual([['catalog', ['A', 'C']], ['notify', ['B']]]);
  });
});

describe('credentialStatus', () => {
  test('segredo mostra só a pista mascarada', () => {
    expect(credentialStatus(f({ configured: true, hint: '••••••••abcd' }))).toBe('configurada ••••••••abcd');
  });
  test('sem configuração e campo público', () => {
    expect(credentialStatus(f({}))).toBe('não configurada');
    expect(credentialStatus(f({ configured: true, secret: false, value: '123' }))).toBe('configurada');
  });
});
