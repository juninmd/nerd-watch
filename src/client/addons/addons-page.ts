import { type AddonDto, getAddonStatus, installAddon, listAddons, removeAddon } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { escapeHtml } from '../ui/card.ts';
import { backButtonHtml, wireBackButton } from '../ui/back-button.ts';
import { icon } from '../ui/icons.ts';
import { addonPath, canBrowse, capabilitySummary, resourceLabel } from './addon-links.ts';

const addonRow = (a: AddonDto): string => `
  <li class="addon-row" data-id="${escapeHtml(a.id)}">
    <div class="addon-logo" aria-hidden="true">${a.logo ? `<img src="${escapeHtml(a.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : icon('plug')}</div>
    <div class="addon-body">
      <h3>${escapeHtml(a.name)} ${a.version ? `<small>v${escapeHtml(a.version)}</small>` : ''}</h3>
      <p class="hint">${escapeHtml(a.host)}</p>
      ${a.description ? `<p class="addon-desc">${escapeHtml(a.description)}</p>` : ''}
      <p class="hint addon-summary">${escapeHtml(capabilitySummary(a))}</p>
      <p class="hint addon-status" data-status>verificando…</p>
      <div class="chip-row">${a.resources.map((r) => `<span class="chip-status">${escapeHtml(resourceLabel(r))}</span>`).join('')}</div>
    </div>
    <div class="addon-actions">
      ${canBrowse(a) ? `<button type="button" class="btn btn-primary btn-sm" data-browse>explorar</button>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-remove aria-label="remover ${escapeHtml(a.name)}">${icon('trash', 'sm')} remover</button>
    </div>
  </li>`;

export const renderAddons = (host: HTMLElement): void => {
  host.innerHTML = `
    <header class="view-head">
      ${backButtonHtml()}
      <h1 class="view-title">Addons do Stremio</h1>
      <p class="view-subtitle">
        Cole o link do <code>manifest.json</code> de um addon (ou <code>stremio://…</code>) para usar o catálogo, os detalhes, os streams e as
        legendas dele aqui dentro. Não há addon pré-instalado nem lista automática: você instala só o que escolher, e o conteúdo e a licença
        dele são responsabilidade de quem o publica. O link fica guardado só neste computador e não entra no backup.
      </p>
    </header>
    <form id="addon-form" class="chip-row form-row" novalidate>
      <input type="text" inputmode="url" id="addon-url" class="input input-pill grow" placeholder="https://…/manifest.json" autocomplete="off" spellcheck="false" aria-label="link do manifest do addon" aria-describedby="addon-err" />
      <button class="btn btn-primary btn-sm" type="submit" id="addon-add">${icon('plus', 'sm')} instalar</button>
    </form>
    <p class="field-err" id="addon-err" role="alert"></p>
    <p class="chip-row" id="addons-discover" hidden><a class="btn btn-ghost btn-sm" href="#/descobrir">${icon('grid', 'sm')} descobrir nos catálogos</a></p>
    <ul class="addon-list" id="addon-list" aria-live="polite"></ul>
  `;
  wireBackButton(host, '/connections');

  const form = host.querySelector('#addon-form') as HTMLFormElement;
  const input = host.querySelector('#addon-url') as HTMLInputElement;
  const submit = host.querySelector('#addon-add') as HTMLButtonElement;
  const err = host.querySelector('#addon-err') as HTMLElement;
  const listEl = host.querySelector('#addon-list') as HTMLElement;
  const discoverLink = host.querySelector('#addons-discover') as HTMLElement;
  let loadSeq = 0;

  const paint = (addons: AddonDto[]) => {
    discoverLink.hidden = !addons.some((a) => a.catalogs.length > 0);
    listEl.innerHTML = addons.length
      ? addons.map(addonRow).join('')
      : `<li class="empty-state"><div class="big">${icon('plug')}</div>nenhum addon instalado ainda</li>`;
    for (const a of addons) {
      const el = listEl.querySelector<HTMLElement>(`.addon-row[data-id="${CSS.escape(a.id)}"] [data-status]`);
      getAddonStatus(a.id)
        .then((s) => {
          if (el?.isConnected) el.textContent = s.ok ? 'status: respondendo' : `status: erro — ${s.error ?? 'sem resposta'}`;
        })
        .catch(() => {
          if (el?.isConnected) el.textContent = 'status: não foi possível verificar';
        });
    }
  };
  const load = () => {
    const seq = ++loadSeq;
    return listAddons()
      .then((addons) => {
        if (!listEl.isConnected || seq !== loadSeq) return;
        paint(addons);
      })
      .catch(() => {
        if (!listEl.isConnected || seq !== loadSeq) return;
        listEl.innerHTML = `<li class="empty-state" role="alert"><div class="big">${icon('alert')}</div>não foi possível carregar os addons</li>`;
      });
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) {
      err.textContent = 'cole o link do manifest do addon';
      input.focus();
      return;
    }
    err.textContent = '';
    submit.disabled = true;
    installAddon(url)
      .then((a) => {
        if (!listEl.isConnected) return;
        input.value = '';
        showToast(`Addon "${a.name}" instalado`);
        return load();
      })
      .catch((error: Error) => {
        if (!listEl.isConnected) return;
        err.textContent = error.message;
        input.focus();
      })
      .finally(() => {
        if (submit.isConnected) submit.disabled = false;
      });
  });

  listEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.addon-row');
    const id = row?.dataset.id;
    if (!row || !id) return;
    if ((e.target as HTMLElement).closest('[data-browse]')) navigate(addonPath(id));
    const removeBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');
    if (removeBtn) {
      const name = row.querySelector('h3')?.textContent?.trim() ?? 'addon';
      if (!confirm(`Remover o addon "${name}"? Nada do seu histórico muda; para voltar a usar, cole o link de novo.`)) return;
      removeBtn.disabled = true;
      removeAddon(id)
        .then(() => {
          if (listEl.isConnected) void load();
        })
        .catch(() => {
          if (removeBtn.isConnected) removeBtn.disabled = false;
          if (listEl.isConnected) showToast('Não foi possível remover o addon');
        });
    }
  });

  load();
};
