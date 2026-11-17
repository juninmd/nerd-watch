import { listCredentials, removeCredential, saveCredentialValue, testCredentialValue, type CredentialDto } from '../api/credentials.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { credentialStatus, groupCredentials } from './credentials-model.ts';

const fieldHtml = (f: CredentialDto): string => {
  const id = `cred-${f.key}`;
  const status = credentialStatus(f);
  return `
    <div class="cred-field" data-key="${escapeHtml(f.key)}">
      <div class="cred-top">
        <label for="${id}"><strong>${escapeHtml(f.label)}</strong> <code>${escapeHtml(f.key)}</code></label>
        <span class="chip-status ${f.configured ? 'ok' : 'off'}" data-status><span class="led${f.configured ? '' : ' off'}"></span>${escapeHtml(status)}</span>
      </div>
      <p class="hint">${escapeHtml(f.help)}${f.restart ? ' Vale depois de reiniciar o app.' : ''}</p>
      <div class="pw-row">
        <input class="input" id="${id}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" value="${f.secret ? '' : escapeHtml(f.value ?? '')}" placeholder="${escapeHtml(f.configured && f.secret ? 'deixe em branco para manter' : f.placeholder)}" />
        ${f.secret ? `<button class="btn btn-ghost" type="button" data-reveal aria-label="Mostrar ou ocultar o que você digitou" aria-pressed="false">${icon('eye', 'sm')}</button>` : ''}
      </div>
      <p class="field-err" data-msg role="status"></p>
      <div class="conn-actions">
        <button class="btn btn-primary btn-sm" type="button" data-save>Salvar</button>
        ${f.testable ? `<button class="btn btn-ghost btn-sm" type="button" data-test ${f.configured ? '' : 'disabled'}>Testar</button>` : ''}
        <button class="btn btn-danger btn-sm" type="button" data-remove ${f.configured ? '' : 'disabled'}>${icon('trash', 'sm')} Remover</button>
      </div>
    </div>`;
};

/** Liga os botões de um campo. O segredo digitado nunca é guardado fora do input e o input é limpo após salvar. */
const wireField = (row: HTMLElement, f: CredentialDto, rerender: () => void): void => {
  const input = row.querySelector('input') as HTMLInputElement;
  const msg = row.querySelector('[data-msg]') as HTMLElement;
  const say = (text: string, ok = false): void => {
    msg.textContent = text;
    msg.style.color = ok ? 'var(--success)' : '';
  };
  const busy = (on: boolean): void => {
    for (const b of row.querySelectorAll('button')) b.disabled = on || (b.matches('[data-test],[data-remove]') && !f.configured);
  };

  row.querySelector('[data-reveal]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
  });

  row.querySelector('[data-save]')?.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return say('Digite um valor para salvar.');
    busy(true);
    try {
      await saveCredentialValue(f.key, value);
      input.value = '';
      showToast(`${f.label} salva`);
      rerender();
    } catch (err) {
      say(err instanceof Error ? err.message : 'não foi possível salvar');
      busy(false);
    }
  });

  row.querySelector('[data-test]')?.addEventListener('click', async () => {
    busy(true);
    say('Testando…', true);
    try {
      const r = await testCredentialValue(f.key);
      say(r.message, r.ok);
    } catch {
      say('não foi possível testar');
    }
    busy(false);
  });

  row.querySelector('[data-remove]')?.addEventListener('click', async () => {
    if (!confirm(`Remover ${f.label}? Ela sai do .env deste computador.`)) return;
    busy(true);
    try {
      await removeCredential(f.key);
      showToast(`${f.label} removida`);
      rerender();
    } catch (err) {
      say(err instanceof Error ? err.message : 'não foi possível remover');
      busy(false);
    }
  });
};

/** Tela dedicada às chaves e tokens. Segredos nunca voltam do servidor: aparecem só como "configurada ••••1234". */
export const renderCredentials = (host: HTMLElement): void => {
  const draw = (): void => {
    void listCredentials()
      .then(({ groups, fields }) => {
        host.innerHTML = `
          <header class="view-head">
            <button class="btn btn-ghost btn-sm" type="button" id="cred-back">${icon('back', 'sm')} Voltar</button>
            <h1 class="view-title">Credenciais</h1>
            <p class="view-subtitle">Chaves e tokens dos serviços. Ficam só no <code>.env</code> deste computador (acesso restrito ao seu usuário) e nunca voltam para a tela.</p>
          </header>
          <div class="conn-grid">
            ${groupCredentials(fields, groups)
              .map(
                (s) => `<section class="conn-card"><div class="conn-head"><span class="conn-ic">${icon('key')}</span><div><h2>${escapeHtml(s.label)}</h2></div></div>${s.fields.map(fieldHtml).join('')}</section>`,
              )
              .join('')}
          </div>`;
        host.querySelector('#cred-back')?.addEventListener('click', () => {
          if (history.length > 1) history.back();
          else navigate('/settings');
        });
        for (const row of host.querySelectorAll<HTMLElement>('.cred-field')) {
          const f = fields.find((x) => x.key === row.dataset.key);
          if (f) wireField(row, f, draw);
        }
      })
      .catch(() => {
        host.innerHTML = `<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div><h1 class="view-title">não foi possível carregar as credenciais</h1></div>`;
      });
  };
  draw();
};
