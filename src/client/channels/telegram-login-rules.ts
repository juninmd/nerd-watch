/** Regras puras do login do Telegram (validação dos campos e contagem do QR), separadas da UI para serem testáveis. */

export const validateApiId = (raw: string): string | null => (/^\d{5,10}$/.test(raw.trim()) ? null : 'o api_id tem de 5 a 10 dígitos');

export const validateApiHash = (raw: string): string | null =>
  /^[a-f0-9]{32}$/i.test(raw.trim()) ? null : 'o api_hash tem 32 caracteres hexadecimais (0-9 e a-f)';

/**
 * Segundos até o token do QR expirar. `expires` vem do Telegram em segundos Unix; qualquer outro valor
 * (ausente, 0) vira `null` — melhor não mostrar contagem do que mostrar uma inventada.
 */
export const qrSecondsLeft = (expires: number, nowMs: number): number | null =>
  expires > 1e9 ? Math.max(0, Math.ceil((expires * 1000 - nowMs) / 1000)) : null;
