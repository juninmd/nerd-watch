import { Accordion, Alert, Avatar, Button, ConfirmButton, TextField } from '@juninmd/sonido';
import { type FormEvent, useEffect, useState } from 'react';
import { saveTelegramSettings, submitTelegramLoginPassword, type TelegramPersonalAccount } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { qrSecondsLeft, validateApiHash, validateApiId } from './telegram-login-rules.ts';

const errText = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

export function SessionEndedAlert() {
  return <Alert tone="warning">A sessão do Telegram foi encerrada (provavelmente em Ajustes → Dispositivos). Entre de novo para voltar a assistir.</Alert>;
}

function BotTokenForm({ onSaved }: { onSaved: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setError('cole o token do bot');
    setError('');
    setBusy(true);
    saveTelegramSettings({ botToken: token.trim() })
      .then(() => {
        showToast('token do bot salvo');
        setToken('');
        onSaved();
      })
      .catch((err) => showToast(errText(err, 'falha ao salvar')))
      .finally(() => setBusy(false));
  };
  return (
    <form className="conn-form" noValidate onSubmit={submit}>
      <TextField
        label="Token do bot (@BotFather)"
        type="password"
        placeholder="123456:ABC-…"
        autoComplete="off"
        value={token}
        error={error || undefined}
        onChange={(e) => setToken(e.currentTarget.value)}
      />
      <Button variant="ghost" size="sm" type="submit" loading={busy}>
        Salvar token
      </Button>
    </form>
  );
}

/** Etapa 1: api_id e api_hash (exigidos pelo Telegram para qualquer app que entre numa conta) e, opcional, o token do bot. */
export function CredentialsStep({ onSaved }: { onSaved: () => void }) {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [errors, setErrors] = useState<{ id?: string; hash?: string }>({});
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = { id: validateApiId(apiId) ?? undefined, hash: validateApiHash(apiHash) ?? undefined };
    setErrors(next);
    if (next.id || next.hash) return;
    setBusy(true);
    saveTelegramSettings({ apiId: Number(apiId.trim()), apiHash: apiHash.trim() })
      .then(onSaved)
      .catch((err) => {
        setBusy(false);
        showToast(errText(err, 'falha ao salvar'));
      });
  };
  return (
    <>
      <p className="hint">
        O Telegram exige um <b>api_id</b> e um <b>api_hash</b> para qualquer app que entre numa conta. Gere os seus (grátis) em{' '}
        <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">
          my.telegram.org/apps
        </a>
        ; eles ficam só no seu computador.
      </p>
      <form className="conn-form" noValidate onSubmit={submit}>
        <TextField label="api_id" inputMode="numeric" placeholder="12345678" autoComplete="off" value={apiId} error={errors.id} onChange={(e) => setApiId(e.currentTarget.value)} />
        <TextField
          label="api_hash"
          type="password"
          placeholder="32 caracteres"
          spellCheck={false}
          autoComplete="off"
          value={apiHash}
          error={errors.hash}
          onChange={(e) => setApiHash(e.currentTarget.value)}
        />
        <Button variant="primary" type="submit" loading={busy}>
          Salvar e continuar
        </Button>
      </form>
      <Accordion items={[{ key: 'bot', title: 'Modo bot (opcional)', content: <BotTokenForm onSaved={onSaved} /> }]} />
    </>
  );
}

/** Etapa 2 (QR): imagem, passo a passo no celular e a contagem até o Telegram renovar o token. */
export function QrStep({ dataUrl, expiresAt, onCancel }: { dataUrl: string; expiresAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = qrSecondsLeft(expiresAt, now);
  return (
    <div className="qr-row">
      <img src={dataUrl} alt="QR code de login do Telegram" width={232} height={232} />
      <div>
        <ol className="howto">
          <li>Abra o Telegram no celular</li>
          <li>
            Vá em <b>Ajustes → Dispositivos</b>
          </li>
          <li>
            Toque em <b>Conectar dispositivo</b> e aponte para o QR
          </li>
        </ol>
        <p className="hint" role="status">
          {left === null ? '' : left > 0 ? `expira em ${left}s` : 'renovando o QR…'}
        </p>
        <CancelButton onCancel={onCancel} />
      </div>
    </div>
  );
}

export function CancelButton({ onCancel }: { onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const click = () => {
    setBusy(true);
    onCancel();
  };
  return (
    <Button variant="ghost" size="sm" disabled={busy} onClick={click}>
      Cancelar
    </Button>
  );
}

/** Etapa 3: senha da verificação em duas etapas. O polling segue rodando; o campo mantém o que já foi digitado. */
export function PasswordStep({ hint, onCancel }: { hint: string; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setError('digite a senha');
    setError('');
    setBusy(true);
    submitTelegramLoginPassword(password).catch(() => {
      showToast('não foi possível enviar a senha');
      setBusy(false);
    });
  };
  return (
    <>
      <p className="hint">QR lido. Sua conta tem verificação em duas etapas{hint ? ` (dica: ${hint})` : ''} — digite a senha para concluir.</p>
      <form className="conn-form" noValidate onSubmit={submit}>
        <div className="pw-row">
          <TextField label="Senha" type={show ? 'text' : 'password'} autoComplete="off" autoFocus value={password} error={error || undefined} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Button variant="ghost" size="sm" aria-pressed={show} onClick={() => setShow((s) => !s)}>
            {show ? 'ocultar' : 'mostrar'}
          </Button>
        </div>
        <Button variant="primary" type="submit" loading={busy}>
          Concluir
        </Button>
      </form>
      <CancelButton onCancel={onCancel} />
    </>
  );
}

const DIAGNOSTICS = (
  <ul className="diag">
    <li>Confira se a internet funciona e se nada bloqueia conexões de saída para o Telegram (porta 443 / proxy / VPN).</li>
    <li>Confira o relógio do computador — hora muito errada faz o Telegram recusar a conexão.</li>
    <li>Tente de novo; se persistir, reinicie o app.</li>
  </ul>
);

export function ErrorStep({ message, onRetry, onFix }: { message: string; onRetry: () => void; onFix: () => void }) {
  const badCredentials = /api[ _]?(id|hash)/i.test(message);
  return (
    <>
      <Alert tone="danger">{message}</Alert>
      {message.includes('conectar') ? (
        DIAGNOSTICS
      ) : badCredentials ? (
        <p className="hint">O Telegram recusou o api_id/api_hash. Confira os valores em my.telegram.org/apps.</p>
      ) : (
        <p className="hint">Se a senha estava errada, escaneie o QR de novo e digite com calma.</p>
      )}
      <div className="conn-actions">
        <Button variant="primary" onClick={onRetry}>
          Tentar de novo
        </Button>
        {badCredentials && (
          <Button variant="ghost" onClick={onFix}>
            Corrigir credenciais
          </Button>
        )}
      </div>
    </>
  );
}

/** Quem está logado: foto (ou inicial, se não houver ou não carregar) + nome e @usuário, que leva ao perfil. */
function AccountCard({ account }: { account: TelegramPersonalAccount }) {
  return (
    <div className="tg-account">
      <Avatar name={account.name} src={account.avatarUrl ?? undefined} size={48} />
      <div>
        <strong>
          <span className="sr-only">Conta conectada: </span>
          {account.name}
        </strong>
        {account.username && (
          <a className="tg-account-handle" href={`https://t.me/${encodeURIComponent(account.username)}`} target="_blank" rel="noopener noreferrer">
            @{account.username}
          </a>
        )}
      </div>
    </div>
  );
}

export function ConnectedStep({ account, onImport, onLogout }: { account: TelegramPersonalAccount | null; onImport: () => void; onLogout: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const logout = () => {
    setBusy(true);
    onLogout().catch(() => setBusy(false));
  };
  return (
    <>
      {account && <AccountCard account={account} />}
      <p className="hint">Conta pessoal conectada: o modo "conta pessoal" já funciona, sem limite de tamanho de arquivo.</p>
      <div className="conn-actions">
        <Button variant="primary" iconStart={<Icon name="download" size="sm" />} onClick={onImport}>
          Importar meus canais
        </Button>
        <ConfirmButton
          variant="ghost"
          loading={busy}
          ask="Encerrar a sessão do Telegram? Você precisará escanear o QR de novo para voltar a usar sua conta (canais já importados continuam)."
          confirmLabel="Encerrar"
          onConfirm={logout}
        >
          Encerrar sessão
        </ConfirmButton>
      </div>
    </>
  );
}
