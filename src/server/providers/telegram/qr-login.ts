import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { config } from '../../config.ts';
import { updateEnvVar } from '../../env-file.ts';

/**
 * Login via QR code (auth.exportLoginToken/UpdateLoginToken do MTProto): o servidor nunca vê telefone,
 * código de SMS nem a session em si — o próprio app do Telegram do usuário aprova o QR. A session
 * resultante é gravada direto no `.env` e nunca volta pro cliente HTTP.
 */
export type LoginState =
  | { status: 'idle' }
  | { status: 'pending'; token: string; expires: number }
  | { status: 'need_password'; hint: string }
  | { status: 'success' }
  | { status: 'error'; message: string };

let state: LoginState = { status: 'idle' };
let abortController: AbortController | null = null;
let passwordResolver: ((password: string) => void) | null = null;
let running = false;

export const getLoginState = (): LoginState => state;

export const cancelLogin = (): void => {
  abortController?.abort();
};

export const submitLoginPassword = (password: string): boolean => {
  if (state.status !== 'need_password' || !passwordResolver) return false;
  passwordResolver(password);
  passwordResolver = null;
  return true;
};

export const startLogin = (): { ok: true } | { ok: false; error: string } => {
  if (running) return { ok: false, error: 'login já em andamento' };
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    return { ok: false, error: 'configure TELEGRAM_API_ID e TELEGRAM_API_HASH antes de entrar com QR code' };
  }

  const apiId = config.telegram.apiId;
  const apiHash = config.telegram.apiHash;
  running = true;
  abortController = new AbortController();
  state = { status: 'pending', token: '', expires: 0 };

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });

  void (async () => {
    try {
      await client.connect();
      await client.signInUserWithQrCode(
        { apiId, apiHash },
        {
          qrCode: async ({ token, expires }) => {
            state = { status: 'pending', token: token.toString('base64url'), expires };
          },
          password: async (hint) => {
            state = { status: 'need_password', hint: hint ?? '' };
            return new Promise<string>((resolve) => {
              passwordResolver = resolve;
            });
          },
          onError: async (err) => {
            state = { status: 'error', message: err.message };
            return true;
          },
          abortSignal: abortController.signal,
        },
      );
      const session = client.session.save();
      updateEnvVar('TELEGRAM_SESSION', session);
      config.telegram.session = session;
      state = { status: 'success' };
    } catch (err) {
      state = err instanceof Error && err.name === 'AbortError' ? { status: 'idle' } : { status: 'error', message: 'falha no login por QR code' };
    } finally {
      await client.disconnect().catch(() => {});
      running = false;
      passwordResolver = null;
    }
  })();

  return { ok: true };
};
