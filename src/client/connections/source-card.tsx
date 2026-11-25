import { Accordion, Button, ConfirmButton, TextField } from '@juninmd/sonido';
import { type FormEvent, useState } from 'react';
import { disconnectSource, getSourceOAuthState, type SourceDto, saveSourceSettings, startSourceOAuth } from '../api/sources.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { isIconName } from '../ui/icons.ts';
import { ConnCard, type ConnStatus } from './conn-card.tsx';
import { useOAuthFlow } from './use-oauth-flow.ts';

const statusOf = (s: SourceDto): ConnStatus => {
  if (s.connected) return { ok: true, label: s.oauth ? 'conectado' : 'configurado' };
  if (s.oauth && s.configured) return { ok: false, label: 'falta autorizar' };
  return { ok: false, label: 'não configurado' };
};

/** Passo a passo do cadastro, vindo do descritor do servidor. */
export function SourceGuide({ guide }: { guide: NonNullable<SourceDto['guide']> }) {
  const steps = (
    <ol className="diag">
      {guide.steps.map((step) => (
        // Seguro: HTML constante do código (descritor da fonte no servidor, com links e <code>), nunca dado de usuário ou de terceiros.
        <li key={step} dangerouslySetInnerHTML={{ __html: step }} />
      ))}
    </ol>
  );
  return <Accordion items={[{ key: 'guide', title: guide.summary, content: steps }]} />;
}

interface SourceCardProps {
  initial: SourceDto;
  /** Conexão ou configuração mudou (o Trakt reavalia suas ações). */
  onChange?: () => void;
}

/**
 * Cartão de uma fonte de vídeo na central de Conexões, desenhado a partir do descritor do servidor:
 * campos de configuração, passo a passo do cadastro e, quando há OAuth, conectar/desconectar.
 */
export function SourceCard({ initial, onChange }: SourceCardProps) {
  const [source, setSource] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(initial.fields.map((f) => [f.key, f.value])));
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const cardId = `src-${source.id}`;

  const oauth = useOAuthFlow(
    () => startSourceOAuth(source.id),
    () => getSourceOAuthState(source.id),
    (o) => {
      if (o.kind === 'connected') {
        setSource((s) => ({ ...s, connected: true, configured: true }));
        showToast(`${source.title} conectado`);
        onChange?.();
      } else if (o.kind === 'error') showToast(o.message);
    },
  );

  const apply = (next: SourceDto) => {
    setSource(next);
    setValues(Object.fromEntries(next.fields.map((f) => [f.key, f.value])));
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const out: Record<string, string> = {};
    for (const f of source.fields) {
      if (f.readOnly) continue;
      const value = values[f.key]?.trim() ?? '';
      // Segredo vazio = manter o que já está salvo (o servidor nunca devolve o valor para repreencher).
      if (f.secret && !value && f.set) continue;
      out[f.key] = value;
    }
    setSaving(true);
    saveSourceSettings(source.id, out)
      .then((next) => {
        apply(next);
        showToast(`${next.title}: configuração salva`);
        onChange?.();
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'não foi possível salvar'))
      .finally(() => setSaving(false));
  };

  const disconnect = () => {
    setDisconnecting(true);
    disconnectSource(source.id)
      .then((next) => {
        apply(next);
        showToast(`${next.title} desconectado`);
        onChange?.();
      })
      .catch(() => showToast('não foi possível desconectar'))
      .finally(() => setDisconnecting(false));
  };

  return (
    <ConnCard id={`conn-${source.id}`} icon={isIconName(source.icon) ? source.icon : 'folder'} title={source.title} description={source.description} status={statusOf(source)}>
      {source.fields.length > 0 && (
        <form className="conn-form" noValidate onSubmit={save}>
          {source.fields.map((f) => (
            <TextField
              key={f.key}
              id={`${cardId}-${f.key}`}
              name={f.key}
              label={f.label}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              readOnly={f.readOnly}
              hint={f.readOnly ? 'Só o arquivo .env altera este campo (por segurança).' : undefined}
              placeholder={f.secret && f.set ? '•••••••• (já definido — deixe vazio para manter)' : f.placeholder}
              value={values[f.key] ?? ''}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setValues((v) => ({ ...v, [f.key]: value }));
              }}
            />
          ))}
          <Button variant="primary" type="submit" loading={saving}>
            Salvar{source.configured ? ' (substituir)' : ''}
          </Button>
        </form>
      )}
      {source.oauth && source.configured && (
        <div className="conn-actions">
          {source.connected ? (
            <ConfirmButton
              variant="ghost"
              loading={disconnecting}
              ask={`Desconectar ${source.title}? Os canais já importados continuam na lista, mas não tocam até reconectar.`}
              confirmLabel="Desconectar"
              onConfirm={disconnect}
            >
              Desconectar
            </ConfirmButton>
          ) : (
            <Button variant="primary" iconStart={<Icon name="play" size="sm" />} loading={oauth.starting} onClick={oauth.connect}>
              Conectar a {source.title}
            </Button>
          )}
        </div>
      )}
      {oauth.waiting && (
        <p className="hint" role="status">
          Conclua a autorização na aba que abriu — esta tela atualiza sozinha.
        </p>
      )}
      {source.add && source.connected && (
        <p className="hint">
          Pronto. Adicione em <a href="#/telegram">Canais</a> (opção "{source.add.label}").
        </p>
      )}
      {source.guide && <SourceGuide guide={source.guide} />}
    </ConnCard>
  );
}
