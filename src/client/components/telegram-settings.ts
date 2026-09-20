import QRCode from 'qrcode';
import {
  cancelTelegramLogin,
  getTelegramLoginStatus,
  getTelegramSettings,
  saveTelegramSettings,
  startTelegramLogin,
  submitTelegramLoginPassword,
  type TelegramLoginState,
  type TelegramSettingsStatus,
} from '../api.ts';
import { showToast } from '../state.ts';

const INPUT_STYLE =
  'width:100%;padding:9px 14px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);margin-bottom:8px';

const badge = (label: string, ok: boolean): string => `<span class="badge${ok ? ' badge-archive' : ''}">${label} ${ok ? '✅' : '—'}</span>`;

/** Painel de credenciais do Telegram (bot token, api_id/hash) + login por QR code da conta pessoal. */
export const renderTelegramSettings = (host: HTMLElement): void => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const stopPolling = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  host.innerHTML = `
    <div class="side-card">
      <h3>⚙️ Credenciais do Telegram</h3>
      <div id="tg-settings-status" class="chip-row" style="margin-bottom:14px;flex-wrap:wrap;gap:6px"></div>

      <p class="hint" style="margin-top:0">token do bot (grátis, via @BotFather)</p>
      <form id="tg-bot-form" style="display:flex;gap:8px;margin-bottom:18px">
        <input type="password" id="tg-bot-token" placeholder="123456:ABC-..." autocomplete="off" style="${INPUT_STYLE};margin-bottom:0" />
        <button class="btn btn-ghost btn-sm" type="submit">salvar</button>
      </form>

      <p class="hint" style="margin-top:0">api_id / api_hash (my.telegram.org) — necessário pra conta pessoal</p>
      <form id="tg-api-form" style="margin-bottom:14px">
        <input type="text" id="tg-api-id" placeholder="api_id" autocomplete="off" inputmode="numeric" style="${INPUT_STYLE}" />
        <input type="password" id="tg-api-hash" placeholder="api_hash" autocomplete="off" style="${INPUT_STYLE}" />
        <button class="btn btn-ghost btn-sm" type="submit" style="width:100%;justify-content:center">salvar</button>
      </form>

      <div id="tg-qr-section"></div>
    </div>
  `;

  const renderStatusBadges = (status: TelegramSettingsStatus) => {
    const el = host.querySelector('#tg-settings-status') as HTMLElement;
    el.innerHTML =
      badge('bot', status.botTokenConfigured) + badge('api_id/hash', status.apiCredentialsConfigured) + badge('conta pessoal', status.personalConfigured);
  };

  const wireCancelButton = () => {
    const cancelBtn = host.querySelector('#tg-qr-cancel') as HTMLButtonElement | null;
    cancelBtn?.addEventListener('click', () => {
      stopPolling();
      cancelTelegramLogin().finally(() => refresh());
    });
  };

  const renderQrSection = (status: TelegramSettingsStatus) => {
    const qrHost = host.querySelector('#tg-qr-section') as HTMLElement;
    stopPolling();
    if (status.personalConfigured) {
      qrHost.innerHTML = `<p class="hint" style="margin:0">✅ conta pessoal logada — já disponível no modo "conta pessoal".</p>`;
      return;
    }
    if (!status.apiCredentialsConfigured) {
      qrHost.innerHTML = '';
      return;
    }
    qrHost.innerHTML = `<button class="btn btn-primary btn-sm" id="tg-qr-start" style="width:100%;justify-content:center">📱 entrar com QR code</button>`;
    const startBtn = qrHost.querySelector('#tg-qr-start') as HTMLButtonElement;
    startBtn.addEventListener('click', () => {
      startBtn.disabled = true;
      startTelegramLogin()
        .then(() => poll())
        .catch((err) => {
          showToast(err instanceof Error ? err.message : 'não foi possível iniciar o login');
          startBtn.disabled = false;
        });
    });
  };

  const renderLoginState = async (state: TelegramLoginState) => {
    if (!host.isConnected) return;
    const qrHost = host.querySelector('#tg-qr-section') as HTMLElement;

    if (state.status === 'pending' && !state.token) {
      qrHost.innerHTML = `
        <p class="hint" style="margin:0">🔄 conectando ao Telegram… (pode levar até 30s)</p>
        <button class="btn btn-ghost btn-sm" id="tg-qr-cancel" style="width:100%;justify-content:center;margin-top:8px">cancelar</button>
      `;
      wireCancelButton();
      return;
    }

    if (state.status === 'pending' && state.token) {
      const dataUrl = await QRCode.toDataURL(`tg://login?token=${state.token}`, { margin: 1, width: 240 });
      if (!host.isConnected) return;
      qrHost.innerHTML = `
        <p class="hint" style="margin-top:0">escaneie no app do Telegram: Ajustes → Dispositivos → Conectar dispositivo</p>
        <img src="${dataUrl}" alt="QR code de login do Telegram" width="240" height="240" style="display:block;margin:0 auto 10px;border-radius:10px" />
        <button class="btn btn-ghost btn-sm" id="tg-qr-cancel" style="width:100%;justify-content:center">cancelar</button>
      `;
      wireCancelButton();
      return;
    }

    if (state.status === 'need_password') {
      qrHost.innerHTML = `
        <p class="hint" style="margin-top:0">conta com verificação em duas etapas${state.hint ? ` (dica: ${state.hint})` : ''}</p>
        <form id="tg-password-form" style="display:flex;gap:8px;margin-bottom:8px">
          <input type="password" id="tg-password-input" placeholder="senha" autocomplete="off" style="${INPUT_STYLE};margin-bottom:0" />
          <button class="btn btn-primary btn-sm" type="submit">enviar</button>
        </form>
        <button class="btn btn-ghost btn-sm" id="tg-qr-cancel" style="width:100%;justify-content:center">cancelar</button>
      `;
      (qrHost.querySelector('#tg-password-form') as HTMLFormElement).addEventListener('submit', (e) => {
        e.preventDefault();
        const pwInput = qrHost.querySelector('#tg-password-input') as HTMLInputElement;
        submitTelegramLoginPassword(pwInput.value)
          .then(() => poll())
          .catch(() => showToast('não foi possível enviar a senha'));
      });
      wireCancelButton();
      return;
    }

    if (state.status === 'success') {
      stopPolling();
      showToast('login da conta pessoal concluído');
      refresh();
      return;
    }

    if (state.status === 'error') {
      stopPolling();
      qrHost.innerHTML = `<p class="hint" style="margin:0;color:var(--danger)">${state.message}</p>`;
    }
  };

  const poll = () => {
    if (!host.isConnected) return;
    getTelegramLoginStatus()
      .then((state) => {
        void renderLoginState(state);
        if (state.status === 'pending' || state.status === 'need_password') pollTimer = setTimeout(poll, 1500);
      })
      .catch(() => {
        pollTimer = setTimeout(poll, 3000);
      });
  };

  const refresh = () => {
    getTelegramSettings()
      .then((status) => {
        renderStatusBadges(status);
        renderQrSection(status);
      })
      .catch(() => {});
  };

  (host.querySelector('#tg-bot-form') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = host.querySelector('#tg-bot-token') as HTMLInputElement;
    const botToken = input.value.trim();
    if (!botToken) return;
    saveTelegramSettings({ botToken })
      .then((status) => {
        showToast('token do bot salvo');
        input.value = '';
        renderStatusBadges(status);
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'falha ao salvar'));
  });

  (host.querySelector('#tg-api-form') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    const apiIdInput = host.querySelector('#tg-api-id') as HTMLInputElement;
    const apiHashInput = host.querySelector('#tg-api-hash') as HTMLInputElement;
    const apiId = Number(apiIdInput.value.trim());
    const apiHash = apiHashInput.value.trim();
    if (!apiId || !apiHash) return;
    saveTelegramSettings({ apiId, apiHash })
      .then((status) => {
        showToast('credenciais salvas');
        apiIdInput.value = '';
        apiHashInput.value = '';
        renderStatusBadges(status);
        renderQrSection(status);
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'falha ao salvar'));
  });

  refresh();
};
