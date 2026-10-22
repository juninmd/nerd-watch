import { escapeHtml } from './card.ts';
import { icon, isIconName } from '../icons.ts';
import { disconnectSource, getSourceOAuthState, saveSourceSettings, startSourceOAuth, type SourceDto } from '../source-api.ts';
import { showToast } from '../state.ts';

const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60_000;

const chipFor = (s: SourceDto): { ok: boolean; label: string } => {
  if (s.connected) return { ok: true, label: s.oauth ? 'conectado' : 'configurado' };
  if (s.oauth && s.configured) return { ok: false, label: 'falta autorizar' };
  return { ok: false, label: 'não configurado' };
};

const fieldHtml = (cardId: string, f: SourceDto['fields'][number]): string => {
  const id = `${cardId}-${f.key}`;
  const placeholder = f.secret && f.set ? '•••••••• (já definido — deixe vazio para manter)' : f.placeholder;
  return `<div class="field"><label for="${id}">${escapeHtml(f.label)}</label><input class="input" id="${id}" name="${escapeHtml(f.key)}" autocomplete="off" spellcheck="false" ${f.secret ? 'type="password"' : ''} value="${escapeHtml(f.value)}" placeholder="${escapeHtml(placeholder)}" /></div>`;
};

/**
 * Cartão de uma fonte de vídeo na central de Conexões, desenhado a partir do descritor do servidor:
 * campos de configuração, passo a passo do cadastro e, quando há OAuth, conectar/desconectar.
 */
export const renderSourceCard = (host: HTMLElement, initial: SourceDto, onChange?: () => void): void => {
  let source = initial;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const cardId = `src-${source.id}`;

  const stopPolling = () => {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const draw = () => {
    const chip = chipFor(source);
    const guide = source.guide
      ? `<details class="conn-more"><summary>${escapeHtml(source.guide.summary)}</summary><ol class="diag">${source.guide.steps.map((step) => `<li>${step}</li>`).join('')}</ol></details>`
      : '';
    const form = source.fields.length
      ? `<form class="conn-form" novalidate>${source.fields.map((f) => fieldHtml(cardId, f)).join('')}<button class="btn btn-primary" type="submit">Salvar${source.configured ? ' (substituir)' : ''}</button></form>`
      : '';
    const oauth = source.oauth && source.configured
      ? `<div class="conn-actions">${
          source.connected
            ? `<button class="btn btn-ghost" data-act="disconnect" type="button">Desconectar</button>`
            : `<button class="btn btn-primary" data-act="connect" type="button">${icon('play', 'sm')} Conectar a ${escapeHtml(source.title)}</button>`
        }</div>`
      : '';
    const add = source.add && source.connected ? `<p class="hint">Pronto. Adicione em <a href="#/telegram">Canais</a> (opção "${escapeHtml(source.add.label)}").</p>` : '';

    host.innerHTML = `
      <div class="conn-head">
        <span class="conn-ic">${icon(isIconName(source.icon) ? source.icon : 'folder')}</span>
        <div><h2>${escapeHtml(source.title)}</h2><p>${escapeHtml(source.description)}</p></div>
        <span class="chip-status ${chip.ok ? 'ok' : 'off'}"><span class="led${chip.ok ? '' : ' off'}"></span>${chip.label}</span>
      </div>
      ${form}${oauth}${add}${guide}`;

    host.querySelector<HTMLFormElement>('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const values: Record<string, string> = {};
      for (const f of source.fields) {
        const input = host.querySelector<HTMLInputElement>(`[name="${f.key}"]`);
        const value = input?.value.trim() ?? '';
        // Segredo vazio = manter o que já está salvo (o servidor nunca devolve o valor para repreencher).
        if (f.secret && !value && f.set) continue;
        values[f.key] = value;
      }
      saveSourceSettings(source.id, values)
        .then((next) => {
          source = next;
          draw();
          showToast(`${source.title}: configuração salva`);
          onChange?.();
        })
        .catch((err) => showToast(err instanceof Error ? err.message : 'não foi possível salvar'));
    });

    host.querySelector<HTMLButtonElement>('[data-act="connect"]')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      startSourceOAuth(source.id)
        .then(({ authUrl }) => {
          window.open(authUrl, '_blank', 'noopener');
          host.insertAdjacentHTML('beforeend', '<p class="hint" role="status">Conclua a autorização na aba que abriu — esta tela atualiza sozinha.</p>');
          stopPolling();
          poll(generation, Date.now());
        })
        .catch((err) => {
          showToast(err instanceof Error ? err.message : 'não foi possível iniciar');
          btn.disabled = false;
        });
    });

    host.querySelector<HTMLButtonElement>('[data-act="disconnect"]')?.addEventListener('click', () => {
      if (!confirm(`Desconectar ${source.title}? Os canais já importados continuam na lista, mas não tocam até reconectar.`)) return;
      disconnectSource(source.id)
        .then((next) => {
          source = next;
          draw();
          showToast(`${source.title} desconectado`);
          onChange?.();
        })
        .catch(() => showToast('não foi possível desconectar'));
    });
  };

  const poll = (gen: number, startedAt: number) => {
    timer = setTimeout(() => {
      getSourceOAuthState(source.id)
        .then((state) => {
          if (gen !== generation) return;
          if (state.status === 'connected' || state.connected) {
            source = { ...source, connected: true, configured: true };
            showToast(`${source.title} conectado`);
            draw();
            onChange?.();
            return;
          }
          if (state.status === 'error') {
            showToast(state.error);
            draw();
            return;
          }
          if (Date.now() - startedAt > POLL_MAX_MS) return draw();
          poll(gen, startedAt);
        })
        .catch(() => {
          if (gen === generation) poll(gen, startedAt);
        });
    }, POLL_MS);
  };

  draw();
  // Saiu da tela: o polling não pode continuar em segundo plano.
  const observer = new MutationObserver(() => {
    if (!host.isConnected) {
      stopPolling();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
};
