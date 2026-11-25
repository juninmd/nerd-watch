import { Button, ConfirmButton, TextField } from '@juninmd/sonido';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { type DriveStatusDto, disconnectDrive, getDriveOAuthState, getDriveStatus, saveDriveSettings, startDriveOAuth } from '../api/drive.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { ConnCard, type ConnStatus } from './conn-card.tsx';
import { SourceGuide } from './source-card.tsx';
import { useOAuthFlow } from './use-oauth-flow.ts';

const GUIDE = {
  summary: 'Como gerar o client ID e o secret (uma vez, grátis)',
  steps: [
    'Em <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a>, crie um projeto e ative a <b>Google Drive API</b>.',
    'Em <b>Tela de consentimento OAuth</b>, escolha "Externo" e <b>publique o app ("Em produção")</b> — em "Teste" o Google expira a autorização a cada 7 dias.',
    'Em <b>Credenciais</b>, crie um <b>ID do cliente OAuth</b> do tipo <b>App para computador</b> e copie o ID e o secret para cá.',
    'Ao conectar, o Google avisará que o app não foi verificado: é o seu próprio app, clique em "Avançado" e continue. O acesso é <b>somente leitura</b>.',
  ],
};

const statusOf = (s: DriveStatusDto | null, failed: boolean): ConnStatus => {
  if (failed) return { ok: false, label: 'indisponível' };
  if (!s) return { ok: false, label: 'verificando…' };
  return {
    ok: s.connected,
    label: s.connected ? 'conectado' : s.clientConfigured ? 'falta autorizar' : 'não configurado',
  };
};

function CredentialsForm({ replacing, onSaved }: { replacing: boolean; onSaved: () => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) return showToast('preencha o client ID e o client secret');
    setBusy(true);
    saveDriveSettings({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      .then(onSaved)
      .catch((err) => {
        setBusy(false);
        showToast(err instanceof Error ? err.message : 'não foi possível salvar');
      });
  };
  return (
    <>
      <p className="hint">
        O Google exige um <b>client ID</b> e um <b>client secret</b> do seu próprio app (acesso só leitura). Eles ficam só no seu computador.
      </p>
      <form className="conn-form" noValidate onSubmit={submit}>
        <TextField label="client ID" placeholder="123456-abc.apps.googleusercontent.com" spellCheck={false} autoComplete="off" value={clientId} onChange={(e) => setClientId(e.currentTarget.value)} />
        <TextField label="client secret" type="password" placeholder="GOCSPX-…" spellCheck={false} autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.currentTarget.value)} />
        <Button variant="primary" type="submit" loading={busy}>
          Salvar{replacing ? ' (substituir)' : ''}
        </Button>
      </form>
    </>
  );
}

/** Cartão "Google Drive" da central de Conexões: credenciais do app, login pelo navegador e desconexão. */
export function DriveConnect() {
  const [status, setStatus] = useState<DriveStatusDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [changing, setChanging] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const alive = useRef(true);

  const load = useCallback(() => {
    getDriveStatus()
      .then((s) => {
        if (!alive.current) return;
        setStatus(s);
        setFailed(false);
        setChanging(false);
      })
      .catch(() => {
        if (alive.current) setFailed(true);
      });
  }, []);

  const oauth = useOAuthFlow(startDriveOAuth, getDriveOAuthState, (o) => {
    if (o.kind === 'connected') showToast('Google Drive conectado');
    else if (o.kind === 'error') showToast(o.message);
    load();
  });

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const disconnect = () => {
    setDisconnecting(true);
    disconnectDrive()
      .then(() => {
        showToast('Google Drive desconectado');
        load();
      })
      .catch(() => showToast('não foi possível desconectar'))
      .finally(() => setDisconnecting(false));
  };

  const body = (() => {
    if (failed) return <p className="hint">não foi possível consultar o servidor</p>;
    if (!status) return <p className="hint">consultando o Drive…</p>;
    if (status.connected) {
      return (
        <>
          <p className="hint">
            Conectado com acesso <b>somente leitura</b>. Adicione pastas em <a href="#/telegram">Canais</a> (opção "pasta do Google Drive").
          </p>
          <div className="conn-actions">
            <ConfirmButton
              variant="ghost"
              loading={disconnecting}
              ask="Desconectar o Google Drive? As pastas já importadas continuam na lista, mas não tocam até reconectar."
              confirmLabel="Desconectar"
              onConfirm={disconnect}
            >
              Desconectar
            </ConfirmButton>
          </div>
        </>
      );
    }
    if (!status.clientConfigured || changing) {
      return (
        <>
          <CredentialsForm replacing={status.clientConfigured} onSaved={load} />
          <SourceGuide guide={GUIDE} />
        </>
      );
    }
    return (
      <>
        <p className="hint">Credenciais salvas. Falta autorizar o acesso (só leitura) na sua conta Google.</p>
        <div className="conn-actions">
          <Button variant="primary" iconStart={<Icon name="folder" size="sm" />} loading={oauth.starting} onClick={oauth.connect}>
            Conectar ao Google Drive
          </Button>
          <Button variant="ghost" onClick={() => setChanging(true)}>
            Trocar credenciais
          </Button>
        </div>
        {oauth.waiting && (
          <p className="hint" role="status">
            Conclua a autorização na aba que abriu — esta tela atualiza sozinha.
          </p>
        )}
        <SourceGuide guide={GUIDE} />
      </>
    );
  })();

  return (
    <ConnCard
      id="conn-drive"
      wide
      icon="folder"
      title="Google Drive"
      description='Assista aos vídeos de pastas do seu Drive aqui dentro, com fila e "continuar assistindo".'
      status={statusOf(status, failed)}
    >
      {body}
    </ConnCard>
  );
}
