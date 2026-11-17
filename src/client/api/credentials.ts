import { json } from './http.ts';

export type CredentialGroupId = 'catalog' | 'telegram' | 'drive' | 'notify';

export interface CredentialDto {
  key: string;
  label: string;
  group: CredentialGroupId;
  secret: boolean;
  help: string;
  placeholder: string;
  /** Só vale depois de reiniciar o app. */
  restart: boolean;
  testable: boolean;
  configured: boolean;
  /** Valor atual, só em campo não secreto. Segredo nunca volta do servidor. */
  value: string | null;
  /** Pista mascarada de um segredo configurado. */
  hint: string | null;
}

export interface CredentialsResponse {
  groups: Record<CredentialGroupId, string>;
  fields: CredentialDto[];
}

export interface CredentialTestResult {
  ok: boolean;
  message: string;
}

const path = (key: string): string => `/api/credentials/${encodeURIComponent(key)}`;

export const listCredentials = (): Promise<CredentialsResponse> => fetch('/api/credentials').then((r) => json<CredentialsResponse>(r));

export const saveCredentialValue = (key: string, value: string): Promise<CredentialDto> =>
  fetch(path(key), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) }).then((r) => json<CredentialDto>(r));

export const removeCredential = (key: string): Promise<CredentialDto> => fetch(path(key), { method: 'DELETE' }).then((r) => json<CredentialDto>(r));

export const testCredentialValue = (key: string): Promise<CredentialTestResult> => fetch(`${path(key)}/test`, { method: 'POST' }).then((r) => json<CredentialTestResult>(r));
