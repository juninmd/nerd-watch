import { updateEnvVar } from '../../env-file.ts';

/** Lê sempre do ambiente (não de um snapshot no boot): salvar pela UI vale na hora, sem reiniciar. */
export const readSetting = (env: string): string | undefined => process.env[env]?.trim() || undefined;

/**
 * Grava no `.env` (0600) e no processo. Sob `bun test` só o processo muda: um teste jamais pode reescrever o
 * `.env` real do usuário com credenciais de fixture.
 */
export const writeSetting = (env: string, value: string): void => {
  if (process.env.NODE_ENV !== 'test') updateEnvVar(env, value);
  if (value) process.env[env] = value;
  else delete process.env[env];
};
