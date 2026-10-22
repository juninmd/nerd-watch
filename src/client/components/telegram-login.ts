import QRCode from 'qrcode';
import {
  cancelTelegramLogin,
  getTelegramLoginStatus,
  getTelegramSettings,
  logoutTelegram,
  saveTelegramSettings,
  startTelegramLogin,
  submitTelegramLoginPassword,
  type TelegramLoginState,
} from '../api.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { qrSecondsLeft, validateApiHash, validateApiId } from '../telegram-login-rules.ts';
import { escapeHtml } from './card.ts';

const WAS_CONNECTED_KEY = 'nw.telegram.wasConnected';
const STEPS = ['Credenciais', 'Escanear', 'Verificação', 'Pronto'];

const remember = (connected: boolean): void => {
  try {
    if (connected) localStorage.setItem(WAS_CONNECTED_KEY, '1');
    else localStorage.removeItem(WAS_CONNECTED_KEY);
  } catch {
    // armazenamento bloqueado: o aviso de sessão expirada simplesmente não aparece
  }
};

const wasConnected = (): boolean => {
  try {
    return localStorage.getItem(WAS_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Avisa o resto do app (pílula da barra superior, paleta) que o estado da conexão mudou. */
const announce = (): void => {
  window.dispatchEvent(new Event('nw:connection-changed'));
};

const stepper = (active: number): string =>
  `<ol class="steps" aria-label="Etapas do login">${STEPS.map(
    (label, i) => `<li class="${i < active ? 'done' : i === active ? 'now' : ''}"${i === active ? ' aria-current="step"' : ''}><span>${i < active ? icon('check', 'sm') : i + 1}</span>${label}</li>`,
  ).join('')}</ol>`;

const field = (id: string, label: string, attrs: string): string =>
  `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" autocomplete="off" ${attrs} /><small class="field-err" id="${id}-err" role="alert"></small></div>`;

const DIAGNOSTICS = `
  <ul class="diag">
    <li>Confira se a internet funciona e se nada bloqueia conexões de saída para o Telegram (porta 443 / proxy / VPN).</li>
    <li>Confira o relógio do computador — hora muito errada faz o Telegram recusar a conexão.</li>
    <li>Tente de novo; se persistir, reinicie o app.</li>
  </ul>`;

/** Cartão do Telegram em Conexões: etapas guiadas de login por QR code (credenciais → QR → 2FA → pronto). */
export const renderTelegramLogin = (host: HTMLElement): void => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let countTimer: ReturnType<typeof setInterval> | null = null;
  // Cada stopPolling() invalida fetches e renderizações em voo de um ciclo anterior (ex.: "cancelar" clicado
  // enquanto uma resposta pendente ainda ia desenhar o QR por cima de um estado mais novo).
  let generation = 0;
  let expiresAt = 0;

  const stopPolling = () => {
    generation++;
    if (pollTimer) clearTimeout(pollTimer);
    if (countTimer) clearInterval(countTimer);
    pollTimer = null;
    countTimer = null;
  };

  const body = (): HTMLElement => host.querySelector('#tg-body') as HTMLElement;
  const mount = (html: string): HTMLElement => {
    body().innerHTML = html;
    return body();
  };

  const setChip = (connected: boolean, label: string) => {
    const chip = host.querySelector('#tg-chip') as HTMLElement;
    chip.className = `chip-status ${connected ? 'ok' : 'off'}`;
    chip.innerHTML = `<span class="led${connected ? '' : ' off'}"></span>${label}`;
  };

  host.innerHTML = `
    <div class="conn-head">
      <span class="conn-ic">${icon('send')}</span>
      <div><h2>Telegram</h2><p>Assista aos vídeos dos seus canais aqui dentro, sem baixar nada.</p></div>
      <span id="tg-chip" class="chip-status off"><span class="led off"></span>verificando…</span>
    </div>
    <div id="tg-body"><p class="hint">consultando o Telegram…</p></div>
  `;

  const bindCancel = (root: HTMLElement) => {
    root.querySelector('#tg-cancel')?.addEventListener('click', () => {
      stopPolling();
      cancelTelegramLogin().finally(() => refresh());
    });
  };

  const startLogin = (btn: HTMLButtonElement) => {
    btn.disabled = true;
    startTelegramLogin()
      .then(() => poll(generation))
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'não foi possível iniciar o login');
        btn.disabled = false;
      });
  };

  const renderCredentials = () => {
    const root = mount(`
      ${wasConnected() ? `<div class="banner warn" role="alert">${icon('alert')}<span>A sessão do Telegram foi encerrada (provavelmente em Ajustes → Dispositivos). Entre de novo para voltar a assistir.</span></div>` : ''}
      ${stepper(0)}
      <p class="hint">O Telegram exige um <b>api_id</b> e um <b>api_hash</b> para qualquer app que entre numa conta. Gere os seus (grátis) em <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">my.telegram.org/apps</a>; eles ficam só no seu computador.</p>
      <form id="tg-creds" class="conn-form" novalidate>
        ${field('tg-api-id', 'api_id', 'inputmode="numeric" placeholder="12345678"')}
        ${field('tg-api-hash', 'api_hash', 'type="password" placeholder="32 caracteres" spellcheck="false"')}
        <button class="btn btn-primary" type="submit">Salvar e continuar</button>
      </form>
      <details class="conn-more"><summary>Modo bot (opcional)</summary>
        <form id="tg-bot" class="conn-form" novalidate>
          ${field('tg-bot-token', 'Token do bot (@BotFather)', 'type="password" placeholder="123456:ABC-…"')}
          <button class="btn btn-ghost btn-sm" type="submit">Salvar token</button>
        </form>
      </details>`);
    const form = root.querySelector('#tg-creds') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const idEl = form.querySelector('#tg-api-id') as HTMLInputElement;
      const hashEl = form.querySelector('#tg-api-hash') as HTMLInputElement;
      const idErr = validateApiId(idEl.value);
      const hashErr = validateApiHash(hashEl.value);
      (form.querySelector('#tg-api-id-err') as HTMLElement).textContent = idErr ?? '';
      (form.querySelector('#tg-api-hash-err') as HTMLElement).textContent = hashErr ?? '';
      if (idErr || hashErr) return;
      saveTelegramSettings({ apiId: Number(idEl.value.trim()), apiHash: hashEl.value.trim() })
        .then(() => refresh())
        .catch((err) => showToast(err instanceof Error ? err.message : 'falha ao salvar'));
    });
    root.querySelector('#tg-bot')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = root.querySelector('#tg-bot-token') as HTMLInputElement;
      if (!input.value.trim()) {
        (root.querySelector('#tg-bot-token-err') as HTMLElement).textContent = 'cole o token do bot';
        return;
      }
      saveTelegramSettings({ botToken: input.value.trim() })
        .then(() => {
          showToast('token do bot salvo');
          input.value = '';
          refresh();
        })
        .catch((err) => showToast(err instanceof Error ? err.message : 'falha ao salvar'));
    });
  };

  const renderReady = () => {
    const root = mount(`
      ${wasConnected() ? `<div class="banner warn" role="alert">${icon('alert')}<span>A sessão do Telegram foi encerrada (provavelmente em Ajustes → Dispositivos). Entre de novo para voltar a assistir.</span></div>` : ''}
      ${stepper(1)}
      <p class="hint">Entrar leva um minuto: você escaneia um QR code com o app do Telegram no celular. O app nunca vê seu telefone nem o código de SMS.</p>
      <button class="btn btn-primary" id="tg-start" type="button">${icon('send', 'sm')} Entrar com QR code</button>`);
    const btn = root.querySelector('#tg-start') as HTMLButtonElement;
    btn.addEventListener('click', () => startLogin(btn));
  };

  const renderConnecting = () => {
    bindCancel(mount(`${stepper(1)}<p class="hint" role="status">Conectando ao Telegram… (até 30 s)</p><button class="btn btn-ghost btn-sm" id="tg-cancel" type="button">Cancelar</button>`));
  };

  const tick = () => {
    const el = host.querySelector('#tg-count');
    if (!el) return;
    const left = qrSecondsLeft(expiresAt, Date.now());
    el.textContent = left === null ? '' : left > 0 ? `expira em ${left}s` : 'renovando o QR…';
  };

  const renderQr = async (state: Extract<TelegramLoginState, { status: 'pending' }>, gen: number) => {
    expiresAt = state.expires;
    const current = host.querySelector<HTMLElement>('#tg-qr-img');
    if (current?.dataset.token === state.token) return;
    const dataUrl = await QRCode.toDataURL(`tg://login?token=${state.token}`, { margin: 1, width: 232 });
    if (!host.isConnected || gen !== generation) return;
    const root = mount(`
      ${stepper(1)}
      <div class="qr-row">
        <img id="tg-qr-img" data-token="${state.token}" src="${dataUrl}" alt="QR code de login do Telegram" width="232" height="232" />
        <div>
          <ol class="howto"><li>Abra o Telegram no celular</li><li>Vá em <b>Ajustes → Dispositivos</b></li><li>Toque em <b>Conectar dispositivo</b> e aponte para o QR</li></ol>
          <p class="hint" id="tg-count" role="status"></p>
          <button class="btn btn-ghost btn-sm" id="tg-cancel" type="button">Cancelar</button>
        </div>
      </div>`);
    bindCancel(root);
    tick();
    if (!countTimer) countTimer = setInterval(tick, 1000);
  };

  const renderPassword = (hint: string) => {
    // O polling segue rodando nesta etapa; recriar o formulário a cada ciclo apagaria a senha digitada.
    if (host.querySelector('#tg-pw-form')) return;
    const root = mount(`
      ${stepper(2)}
      <p class="hint">QR lido. Sua conta tem verificação em duas etapas${hint ? ` (dica: ${escapeHtml(hint)})` : ''} — digite a senha para concluir.</p>
      <form id="tg-pw-form" class="conn-form" novalidate>
        <div class="field"><label for="tg-pw">Senha</label>
          <span class="pw-row"><input class="input" id="tg-pw" type="password" autocomplete="off" />
          <button class="btn btn-ghost btn-sm" id="tg-pw-toggle" type="button" aria-pressed="false">mostrar</button></span>
          <small class="field-err" id="tg-pw-err" role="alert"></small></div>
        <button class="btn btn-primary" type="submit">Concluir</button>
      </form>
      <button class="btn btn-ghost btn-sm" id="tg-cancel" type="button">Cancelar</button>`);
    const input = root.querySelector('#tg-pw') as HTMLInputElement;
    const toggle = root.querySelector('#tg-pw-toggle') as HTMLButtonElement;
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'ocultar' : 'mostrar';
      toggle.setAttribute('aria-pressed', String(show));
    });
    (root.querySelector('#tg-pw-form') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value) {
        (root.querySelector('#tg-pw-err') as HTMLElement).textContent = 'digite a senha';
        return;
      }
      const submit = root.querySelector('#tg-pw-form button[type="submit"]') as HTMLButtonElement;
      submit.disabled = true;
      submitTelegramLoginPassword(input.value).catch(() => {
        showToast('não foi possível enviar a senha');
        submit.disabled = false;
      });
    });
    bindCancel(root);
    input.focus();
  };

  const renderError = (message: string) => {
    const badCredentials = /api[ _]?(id|hash)/i.test(message);
    const root = mount(`
      ${stepper(1)}
      <div class="banner err" role="alert">${icon('alert')}<span>${escapeHtml(message)}</span></div>
      ${message.includes('conectar') ? DIAGNOSTICS : badCredentials ? '<p class="hint">O Telegram recusou o api_id/api_hash. Confira os valores em my.telegram.org/apps.</p>' : '<p class="hint">Se a senha estava errada, escaneie o QR de novo e digite com calma.</p>'}
      <div class="conn-actions">
        <button class="btn btn-primary" id="tg-retry" type="button">Tentar de novo</button>
        ${badCredentials ? '<button class="btn btn-ghost" id="tg-fix" type="button">Corrigir credenciais</button>' : ''}
      </div>`);
    root.querySelector('#tg-retry')?.addEventListener('click', () => refresh());
    root.querySelector('#tg-fix')?.addEventListener('click', renderCredentials);
  };

  const renderConnected = () => {
    remember(true);
    const root = mount(`
      ${stepper(4)}
      <p class="hint">Conta pessoal conectada: o modo "conta pessoal" já funciona, sem limite de tamanho de arquivo.</p>
      <div class="conn-actions">
        <button class="btn btn-primary" id="tg-import" type="button">${icon('download', 'sm')} Importar meus canais</button>
        <button class="btn btn-ghost" id="tg-logout" type="button">Encerrar sessão</button>
      </div>`);
    root.querySelector('#tg-import')?.addEventListener('click', () => navigate('/telegram?import=1'));
    root.querySelector('#tg-logout')?.addEventListener('click', () => {
      if (!confirm('Encerrar a sessão do Telegram? Você precisará escanear o QR de novo para voltar a usar sua conta (canais já importados continuam).')) return;
      remember(false);
      logoutTelegram()
        .then(() => {
          showToast('sessão encerrada');
          announce();
          refresh();
        })
        .catch(() => showToast('não foi possível encerrar a sessão'));
    });
  };

  const renderLoginState = (state: TelegramLoginState, gen: number) => {
    if (!host.isConnected || gen !== generation) return;
    if (state.status === 'pending') {
      if (!state.token) renderConnecting();
      else void renderQr(state, gen);
    } else if (state.status === 'need_password') {
      if (countTimer) clearInterval(countTimer);
      countTimer = null;
      renderPassword(state.hint);
    } else if (state.status === 'success') {
      stopPolling();
      showToast('Telegram conectado');
      announce();
      refresh();
    } else if (state.status === 'error') {
      stopPolling();
      renderError(state.message);
    }
  };

  const poll = (gen: number) => {
    if (!host.isConnected || gen !== generation) return;
    getTelegramLoginStatus()
      .then((state) => {
        if (gen !== generation) return;
        renderLoginState(state, gen);
        if (state.status === 'pending' || state.status === 'need_password') pollTimer = setTimeout(() => poll(gen), 1500);
      })
      .catch(() => {
        if (gen === generation) pollTimer = setTimeout(() => poll(gen), 3000);
      });
  };

  const refresh = () => {
    stopPolling();
    getTelegramSettings(true)
      .then((s) => {
        setChip(s.personalConfigured, s.personalConfigured ? 'conectado' : s.apiCredentialsConfigured ? 'desconectado' : 'não configurado');
        if (s.personalConfigured) return renderConnected();
        if (wasConnected()) announce();
        if (!s.apiCredentialsConfigured) return renderCredentials();
        // Voltar à página no meio de um login: retoma o QR em vez de oferecer "entrar" (que falharia com "já em andamento").
        const gen = generation;
        return getTelegramLoginStatus().then((state) => {
          if (gen !== generation) return;
          if (state.status === 'pending' || state.status === 'need_password') poll(gen);
          else renderReady();
        });
      })
      .catch(() => mount('<p class="hint">não foi possível consultar o Telegram agora</p>'));
  };

  refresh();
};
