import { health } from '../api/index.ts';
import { installedVersion, versionLabel } from '../platform/version.ts';
import { icon, type IconName } from '../ui/icons.ts';
import { notifySummary } from './settings-model.ts';
import { openShortcutHelp } from './shortcuts.ts';
import { getShowSpoilers, setShowSpoilers } from './state.ts';
import { getThemePref, setThemePref, THEME_LABEL, THEME_PREFS, type ThemePref } from './theme.ts';
import { logout } from './logout.ts';

const THEME_ICON: Record<ThemePref, IconName> = { dark: 'moon', light: 'sun', system: 'monitor' };

/** Ajustes e avisos: aparência, spoilers, atalhos, estado dos avisos de lançamento e sessão. */
export const renderSettings = (host: HTMLElement): void => {
  const pref = getThemePref();
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Ajustes e avisos</h1>
      <p class="view-subtitle">Aparência, spoilers, atalhos e o estado dos avisos de lançamento.</p>
    </header>
    <div class="conn-grid">
      <section class="conn-card">
        <div class="conn-head"><span class="conn-ic">${icon('moon')}</span><div><h2>Tema</h2><p>Escuro é o padrão. "Sistema" acompanha o seu aparelho.</p></div></div>
        <div class="seg" role="radiogroup" aria-label="Tema">
          ${THEME_PREFS.map(
            (p) => `<button type="button" class="seg-btn" role="radio" aria-checked="${p === pref}" data-theme-pref="${p}">${icon(THEME_ICON[p], 'sm')} ${THEME_LABEL[p]}</button>`,
          ).join('')}
        </div>
      </section>
      <section class="conn-card">
        <div class="conn-head"><span class="conn-ic">${icon('eyeOff')}</span><div><h2>Spoilers</h2><p>Esconde nomes e sinopses de episódios que você ainda não viu.</p></div></div>
        <label class="switch"><input type="checkbox" id="set-spoilers" ${getShowSpoilers() ? 'checked' : ''} /><span class="switch-track"></span>Mostrar spoilers</label>
      </section>
      <section class="conn-card">
        <div class="conn-head"><span class="conn-ic">${icon('keyboard')}</span><div><h2>Atalhos de teclado</h2><p>Ctrl K abre a paleta; g + letra vai a uma tela; ? lista todos.</p></div></div>
        <div class="conn-actions"><button class="btn btn-ghost" id="set-keys" type="button">${icon('keyboard', 'sm')} Ver atalhos</button></div>
      </section>
      <section class="conn-card" id="set-notify">
        <div class="conn-head"><span class="conn-ic">${icon('bell')}</span><div><h2>Avisos de lançamento</h2><p id="set-notify-text">Consultando o servidor…</p></div><span class="chip-status off" id="set-notify-chip" hidden></span></div>
        <p class="hint">Os destinos e a antecedência (0 a 7 dias) ficam no <code>.env</code>, nunca no navegador: <code>NOTIFY_WEBHOOK_URL</code>, <code>NOTIFY_NTFY_URL</code>, <code>NOTIFY_DISCORD_WEBHOOK_URL</code>, <code>NOTIFY_TELEGRAM_*</code> e <code>NOTIFY_LEAD_DAYS</code>. Detalhes em docs/providers/notifications.md.</p>
      </section>
      <section class="conn-card" id="set-session" hidden>
        <div class="conn-head"><span class="conn-ic">${icon('shield')}</span><div><h2>Acesso por token</h2><p>Este servidor pede login. Sair encerra a sessão em todos os aparelhos.</p></div></div>
        <div class="conn-actions"><button class="btn btn-ghost" id="set-logout" type="button">${icon('logout', 'sm')} Sair</button></div>
      </section>
    </div>
    <p class="hint conn-version" id="set-version" hidden></p>`;

  for (const btn of host.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')) {
    btn.addEventListener('click', () => {
      setThemePref(btn.dataset.themePref as ThemePref);
      for (const b of host.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')) b.setAttribute('aria-checked', String(b === btn));
    });
  }
  (host.querySelector('#set-spoilers') as HTMLInputElement).addEventListener('change', (e) => setShowSpoilers((e.target as HTMLInputElement).checked));
  host.querySelector('#set-keys')?.addEventListener('click', openShortcutHelp);
  host.querySelector('#set-logout')?.addEventListener('click', () => void logout());

  void health()
    .then((h) => {
      (host.querySelector('#set-notify-text') as HTMLElement).textContent = notifySummary(h.notifyEnabled, h.notifyLeadDays);
      const chip = host.querySelector('#set-notify-chip') as HTMLElement;
      chip.className = `chip-status ${h.notifyEnabled ? 'ok' : 'off'}`;
      chip.innerHTML = `<span class="led${h.notifyEnabled ? '' : ' off'}"></span>${h.notifyEnabled ? 'ligados' : 'desligados'}`;
      chip.hidden = false;
      (host.querySelector('#set-session') as HTMLElement).hidden = !h.accessEnabled;
    })
    .catch(() => {
      (host.querySelector('#set-notify-text') as HTMLElement).textContent = 'Não foi possível consultar o servidor.';
    });

  const versionEl = host.querySelector('#set-version') as HTMLElement;
  void installedVersion().then((v) => {
    const label = versionLabel(v);
    if (!label) return;
    versionEl.textContent = label;
    versionEl.hidden = false;
  });
};
