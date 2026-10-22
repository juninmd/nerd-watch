import { describe, expect, test } from 'bun:test';
import { isDeadSessionError } from '../src/server/providers/telegram/personal.ts';

describe('isDeadSessionError', () => {
  test.each(['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED'])('%s derruba a session (encerrada no app do Telegram)', (errorMessage) => {
    expect(isDeadSessionError({ errorMessage })).toBe(true);
  });

  test('erros transitórios não derrubam a session', () => {
    expect(isDeadSessionError({ errorMessage: 'FLOOD_WAIT_30' })).toBe(false);
    expect(isDeadSessionError(new Error('timeout'))).toBe(false);
    expect(isDeadSessionError(null)).toBe(false);
  });
});
