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

/** Teto pra fase de conexão (antes do 1º token real chegar) — depois disso o usuário tem tempo ilimitado pra escanear. */
const CONNECT_TIMEOUT_MS = 30_000;

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

  let gotFirstToken = false;
  let timedOut = false;
  let onErrorSetMessage = false;
  const connectTimeout = setTimeout(() => {
    if (gotFirstToken) return;
    timedOut = true;
    abortController?.abort();
  }, CONNECT_TIMEOUT_MS);

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });

  void (async () => {
    try {
      await client.connect();
      await client.signInUserWithQrCode(
        { apiId, apiHash },
        {
          qrCode: async ({ token, expires }) => {
            gotFirstToken = true;
            clearTimeout(connectTimeout);
            state = { status: 'pending', token: token.toString('base64url'), expires };
          },
          password: async (hint) => {
            state = { status: 'need_password', hint: hint ?? '' };
            return new Promise<string>((resolve, reject) => {
              passwordResolver = resolve;
              // Sem isso, cancelar (ou abandonar) o login na etapa de senha 2FA trava pra sempre: essa promise
              // só resolve via submitLoginPassword, então o abort nunca desbloqueava o await lá embaixo — `running`
              // ficava true pra sempre e todo /login/start seguinte devolvia "login já em andamento".
              abortController?.signal.addEventListener(
                'abort',
                () => {
                  passwordResolver = null;
                  const err = new Error('login cancelado');
                  err.name = 'AbortError';
                  reject(err);
                },
                { once: true },
              );
            });
          },
          onError: async (err) => {
            onErrorSetMessage = true;
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
      if (err instanceof Error && err.name === 'AbortError') {
        state = timedOut
          ? { status: 'error', message: `não foi possível conectar ao Telegram em ${CONNECT_TIMEOUT_MS / 1000}s — verifique rede/firewall e tente de novo` }
          : { status: 'idle' };
      } else if (err instanceof Error && err.message === 'AUTH_USER_CANCEL' && onErrorSetMessage) {
        // teleproto sintetiza esse erro depois de onError já ter guardado a mensagem real (ex.: senha errada) —
        // não sobrescreve com um texto que parece "usuário cancelou" quando na verdade foi outra coisa.
      } else {
        const message = err instanceof Error ? err.message : 'falha no login por QR code';
        console.error('[telegram qr-login] falhou:', message);
        state = { status: 'error', message };
      }
    } finally {
      clearTimeout(connectTimeout);
      await client.disconnect().catch(() => {});
      running = false;
      passwordResolver = null;
    }
  })();

  return { ok: true };
};
