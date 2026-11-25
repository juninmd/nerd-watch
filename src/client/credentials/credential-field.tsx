import { Badge, Button, ConfirmButton, TextField } from '@juninmd/sonido';
import { useState } from 'react';
import { type CredentialDto, removeCredential, saveCredentialValue, testCredentialValue } from '../api/credentials.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { credentialStatus } from './credentials-model.ts';

/** Um campo de credencial. O segredo digitado só vive no estado do campo e é limpo depois de salvar. */
export function CredentialField({ field: f, onChanged }: { field: CredentialDto; onChanged: () => void }) {
  const [value, setValue] = useState(f.secret ? '' : (f.value ?? ''));
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const save = async () => {
    const v = value.trim();
    if (!v) return setMsg({ text: 'Digite um valor para salvar.', ok: false });
    setBusy(true);
    try {
      await saveCredentialValue(f.key, v);
      setValue('');
      showToast(`${f.label} salva`);
      onChanged();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'não foi possível salvar', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg({ text: 'Testando…', ok: true });
    try {
      const r = await testCredentialValue(f.key);
      setMsg({ text: r.message, ok: r.ok });
    } catch {
      setMsg({ text: 'não foi possível testar', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeCredential(f.key);
      showToast(`${f.label} removida`);
      onChanged();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'não foi possível remover', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cred-field">
      <div className="cred-top">
        <code>{f.key}</code>
        <Badge tone={f.configured ? 'success' : 'neutral'} dot>
          {credentialStatus(f)}
        </Badge>
      </div>
      <div className="pw-row">
        <TextField
          id={`cred-${f.key}`}
          label={f.label}
          hint={`${f.help}${f.restart ? ' Vale depois de reiniciar o app.' : ''}`}
          type={f.secret && !reveal ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={f.configured && f.secret ? 'deixe em branco para manter' : f.placeholder}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        {f.secret && (
          <Button variant="ghost" size="icon" aria-label="Mostrar ou ocultar o que você digitou" aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
            <Icon name="eye" size="sm" />
          </Button>
        )}
      </div>
      <p className={`cred-msg${msg?.ok ? ' is-ok' : ''}`} role="status">
        {msg?.text}
      </p>
      <div className="conn-actions">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>
          Salvar
        </Button>
        {f.testable && (
          <Button variant="ghost" size="sm" disabled={busy || !f.configured} onClick={() => void test()}>
            Testar
          </Button>
        )}
        <ConfirmButton
          size="sm"
          disabled={busy || !f.configured}
          iconStart={<Icon name="trash" size="sm" />}
          ask={`Remover ${f.label}? Ela sai do .env deste computador.`}
          confirmLabel="Remover"
          onConfirm={() => void remove()}
        >
          Remover
        </ConfirmButton>
      </div>
    </div>
  );
}
