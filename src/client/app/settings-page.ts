import { health } from '../api/index.ts';
import { resolveVersionStatus } from '../platform/version-info.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon, type IconName } from '../ui/icons.ts';
import { notifySummary } from './settings-model.ts';
import { openShortcutHelp } from './shortcuts.ts';
import { getThemePref, setThemePref, THEME_LABEL, THEME_PREFS, type ThemePref } from './theme.ts';
import { logout } from './logout.ts';

const THEME_ICON: Record<ThemePref, IconName> = { dark: 'moon', light: 'sun', system: 'monitor' };

/** Ajustes e avisos: aparência, atalhos, estado dos avisos de lançamento e sessão. */
export const renderSettings = (host: HTMLElement): void => {
  const pref = getThemePref();
  const root = document.createElement('div');
  root.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Ajustes e avisos</h1>
      <p class="view-subtitle">Aparência, atalhos e o estado dos avisos de lançamento.</p>
    </header>
    <div class="conn-grid">
      <section class="conn-card">
        <div class="conn-head"><span class="conn-ic">${icon('moon')}</span><div><h2>Tema</h2><p>Escuro é o padrão. "Sistema" acompanha o seu aparelho.</p></div></div>
        <div class="seg-control" role="radiogroup" aria-label="Tema">
          ${THEME_PREFS.map(
            (p) => `<button type="button" class="seg-btn" role="radio" aria-checked="${p === pref}" data-theme-pref="${p}">${icon(THEME_ICON[p], 'sm')} ${THEME_LABEL[p]}</button>`,
          ).join('')}
        </div>
      </section>
      <section class="conn-card">
        <div class="conn-head"><span class="conn-ic">${icon('keyboard')}</span><div><h2>Atalhos de teclado</h2><p>Ctrl K abre a paleta; g + letra vai a uma tela; ? lista todos.</p></div></div>
        <div class="conn-actions"><button class="btn btn-ghost" id="set-keys" type="button">${icon('keyboard', 'sm')} Ver atalhos</button></div>
      </section>
      <section class="conn-card" id="set-notify">
        <div class="conn-head"><span class="conn-ic">${icon('bell')}</span><div><h2>Avisos de lançamento</h2><p id="set-notify-text">Consultando o servidor…</p></div><span class="chip-status off" id="set-notify-chip" hidden></span></div>
        <p class="hint">Os destinos ficam no <code>.env</code>, nunca no navegador: edite em <a href="#/credentials">Credenciais</a> ou direto no arquivo. A antecedência (0 a 7 dias) só pelo <code>.env</code>: <code>NOTIFY_WEBHOOK_URL</code>, <code>NOTIFY_NTFY_URL</code>, <code>NOTIFY_DISCORD_WEBHOOK_URL</code>, <code>NOTIFY_TELEGRAM_*</code> e <code>NOTIFY_LEAD_DAYS</code>. Detalhes em docs/providers/notifications.md.</p>
      </section>
      <section class="conn-card" id="set-version-card">
        <div class="conn-head"><span class="conn-ic">${icon('download')}</span><div><h2>Versão do app</h2><p id="set-version-text">Consultando versão…</p></div><span class="chip-status update" id="set-version-chip" hidden></span></div>
        <div class="conn-actions" id="set-version-actions" hidden></div>
      </section>
      <section class="conn-card" id="set-session" hidden>
        <div class="conn-head"><span class="conn-ic">${icon('shield')}</span><div><h2>Acesso por token</h2><p>Este servidor pede login. Sair encerra a sessão em todos os aparelhos.</p></div></div>
        <div class="conn-actions"><button class="btn btn-ghost" id="set-logout" type="button">${icon('logout', 'sm')} Sair</button></div>
      </section>
    </div>`;
  host.replaceChildren(root);

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')) {
    btn.addEventListener('click', () => {
      setThemePref(btn.dataset.themePref as ThemePref);
      for (const b of root.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')) b.setAttribute('aria-checked', String(b === btn));
    });
  }
  root.querySelector('#set-keys')?.addEventListener('click', openShortcutHelp);
  const logoutBtn = root.querySelector<HTMLButtonElement>('#set-logout');
  logoutBtn?.addEventListener('click', () => {
    if (logoutBtn.disabled) return;
    logoutBtn.disabled = true;
    void logout().finally(() => {
      if (logoutBtn.isConnected) logoutBtn.disabled = false;
    });
  });

  void health()
    .then((h) => {
      if (!root.isConnected) return;
      const notifyText = root.querySelector<HTMLElement>('#set-notify-text');
      const chip = root.querySelector<HTMLElement>('#set-notify-chip');
      const sessionCard = root.querySelector<HTMLElement>('#set-session');
      if (!notifyText || !chip || !sessionCard) return;
      notifyText.textContent = notifySummary(h.notifyEnabled, h.notifyLeadDays);
      chip.className = `chip-status ${h.notifyEnabled ? 'ok' : 'off'}`;
      chip.innerHTML = `<span class="led${h.notifyEnabled ? '' : ' off'}"></span>${h.notifyEnabled ? 'ligados' : 'desligados'}`;
      chip.hidden = false;
      sessionCard.hidden = !h.accessEnabled;
    })
    .catch(() => {
      if (!root.isConnected) return;
      const notifyText = root.querySelector<HTMLElement>('#set-notify-text');
      if (notifyText) notifyText.textContent = 'Não foi possível consultar o servidor.';
    });

  void mountVersion(root).catch(() => {
    if (!root.isConnected) return;
    const text = root.querySelector<HTMLElement>('#set-version-text');
    if (text) text.textContent = 'Versão indisponível neste momento.';
  });
};

const mountVersion = async (root: HTMLElement): Promise<void> => {
  const status = await resolveVersionStatus();
  if (!root.isConnected) return;
  const text = root.querySelector<HTMLElement>('#set-version-text');
  if (!text) return;
  if (!status) {
    text.textContent = 'Versão indisponível neste momento.';
    return;
  }
  text.textContent = `${status.installed ? 'Versão instalada' : 'Versão do servidor'}: v${status.version}`;
  if (!status.latest) return;
  root.querySelector('#set-version-card')?.classList.add('has-update');
  const chip = root.querySelector<HTMLElement>('#set-version-chip');
  if (chip) {
    chip.textContent = `Nova v${status.latest.version}`;
    chip.hidden = false;
  }
  text.textContent += ` · disponível: v${status.latest.version}`;
  const actions = root.querySelector<HTMLElement>('#set-version-actions');
  if (!actions) return;
  actions.innerHTML = `<a class="btn btn-primary" href="${escapeHtml(status.latest.url)}" target="_blank" rel="noopener noreferrer">${icon('download', 'sm')} Baixar v${escapeHtml(status.latest.version)}</a>`;
  actions.hidden = false;
};
