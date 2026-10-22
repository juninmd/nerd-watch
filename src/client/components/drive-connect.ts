import { type DriveStatusDto, disconnectDrive, getDriveOAuthState, getDriveStatus, saveDriveSettings, startDriveOAuth } from '../drive-api.ts';
import { icon } from '../icons.ts';
import { showToast } from '../state.ts';

const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60_000;

const field = (id: string, label: string, attrs: string): string =>
  `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" autocomplete="off" ${attrs} /></div>`;

const GUIDE = `
  <details class="conn-more">
    <summary>Como gerar o client ID e o secret (uma vez, grátis)</summary>
    <ol class="diag">
      <li>Em <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a>, crie um projeto e ative a <b>Google Drive API</b>.</li>
      <li>Em <b>Tela de consentimento OAuth</b>, escolha "Externo" e <b>publique o app ("Em produção")</b> — em "Teste" o Google expira a autorização a cada 7 dias.</li>
      <li>Em <b>Credenciais</b>, crie um <b>ID do cliente OAuth</b> do tipo <b>App para computador</b> e copie o ID e o secret para cá.</li>
      <li>Ao conectar, o Google avisará que o app não foi verificado: é o seu próprio app, clique em "Avançado" e continue. O acesso é <b>somente leitura</b>.</li>
    </ol>
  </details>`;

/** Cartão "Google Drive" da central de Conexões: credenciais do app, login pelo navegador e desconexão. */
export const renderDriveConnect = (host: HTMLElement): void => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const stopPolling = () => {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  host.innerHTML = `
    <div class="conn-head">
      <span class="conn-ic">${icon('folder')}</span>
      <div><h2>Google Drive</h2><p>Assista aos vídeos de pastas do seu Drive aqui dentro, com fila e "continuar assistindo".</p></div>
      <span id="gd-chip" class="chip-status off"><span class="led off"></span>verificando…</span>
    </div>
    <div id="gd-body"><p class="hint">consultando o Drive…</p></div>
  `;
  const body = host.querySelector('#gd-body') as HTMLElement;
  const chip = host.querySelector('#gd-chip') as HTMLElement;

  const setChip = (connected: boolean, label: string) => {
    chip.className = `chip-status ${connected ? 'ok' : 'off'}`;
    chip.innerHTML = `<span class="led${connected ? '' : ' off'}"></span>${label}`;
  };

  const poll = (gen: number, startedAt: number) => {
    timer = setTimeout(() => {
      getDriveOAuthState()
        .then((state) => {
          if (gen !== generation) return;
          if (state.status === 'connected' || state.connected) {
            showToast('Google Drive conectado');
            return render();
          }
          if (state.status === 'error') {
            showToast(state.error);
            return render();
          }
          if (Date.now() - startedAt > POLL_MAX_MS) return render();
          poll(gen, startedAt);
        })
        .catch(() => {
          if (gen === generation) poll(gen, startedAt);
        });
    }, POLL_MS);
  };

  const renderForm = (s: DriveStatusDto) => {
    body.innerHTML = `
      <p class="hint">O Google exige um <b>client ID</b> e um <b>client secret</b> do seu próprio app (acesso só leitura). Eles ficam só no seu computador.</p>
      <form id="gd-creds" class="conn-form" novalidate>
        ${field('gd-client-id', 'client ID', 'placeholder="123456-abc.apps.googleusercontent.com" spellcheck="false"')}
        ${field('gd-client-secret', 'client secret', 'type="password" placeholder="GOCSPX-…" spellcheck="false"')}
        <button class="btn btn-primary" type="submit">Salvar${s.clientConfigured ? ' (substituir)' : ''}</button>
      </form>${GUIDE}`;
    (body.querySelector('#gd-creds') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      const clientId = (body.querySelector('#gd-client-id') as HTMLInputElement).value.trim();
      const clientSecret = (body.querySelector('#gd-client-secret') as HTMLInputElement).value.trim();
      if (!clientId || !clientSecret) return showToast('preencha o client ID e o client secret');
      saveDriveSettings({ clientId, clientSecret })
        .then(() => render())
        .catch((err) => showToast(err instanceof Error ? err.message : 'não foi possível salvar'));
    });
  };

  const renderConnect = () => {
    body.innerHTML = `
      <p class="hint">Credenciais salvas. Falta autorizar o acesso (só leitura) na sua conta Google.</p>
      <div class="conn-actions">
        <button class="btn btn-primary" id="gd-connect" type="button">${icon('folder', 'sm')} Conectar ao Google Drive</button>
        <button class="btn btn-ghost" id="gd-change" type="button">Trocar credenciais</button>
      </div>${GUIDE}`;
    (body.querySelector('#gd-change') as HTMLButtonElement).addEventListener('click', () => renderForm({ clientConfigured: true, connected: false }));
    const btn = body.querySelector('#gd-connect') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      startDriveOAuth()
        .then(({ authUrl }) => {
          window.open(authUrl, '_blank', 'noopener');
          body.insertAdjacentHTML('beforeend', '<p class="hint" role="status">Conclua a autorização na aba que abriu — esta tela atualiza sozinha.</p>');
          stopPolling();
          poll(generation, Date.now());
        })
        .catch((err) => {
          showToast(err instanceof Error ? err.message : 'não foi possível iniciar');
          btn.disabled = false;
        });
    });
  };

  const renderConnected = () => {
    body.innerHTML = `
      <p class="hint">Conectado com acesso <b>somente leitura</b>. Adicione pastas em <a href="#/telegram">Canais</a> (opção "pasta do Google Drive").</p>
      <div class="conn-actions"><button class="btn btn-ghost" id="gd-disconnect" type="button">Desconectar</button></div>`;
    (body.querySelector('#gd-disconnect') as HTMLButtonElement).addEventListener('click', () => {
      if (!confirm('Desconectar o Google Drive? As pastas já importadas continuam na lista, mas não tocam até reconectar.')) return;
      disconnectDrive()
        .then(() => {
          showToast('Google Drive desconectado');
          render();
        })
        .catch(() => showToast('não foi possível desconectar'));
    });
  };

  const render = () => {
    stopPolling();
    getDriveStatus()
      .then((s) => {
        setChip(s.connected, s.connected ? 'conectado' : s.clientConfigured ? 'falta autorizar' : 'não configurado');
        if (s.connected) renderConnected();
        else if (s.clientConfigured) renderConnect();
        else renderForm(s);
      })
      .catch(() => {
        setChip(false, 'indisponível');
        body.innerHTML = '<p class="hint">não foi possível consultar o servidor</p>';
      });
  };

  render();
  // Saiu da tela: o polling não pode continuar em segundo plano.
  const observer = new MutationObserver(() => {
    if (!host.isConnected) {
      stopPolling();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
};
