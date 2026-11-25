import { EmptyState, Skeleton } from '@juninmd/sonido';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listCredentials } from '../api/credentials.ts';
import { ConnCard } from '../connections/conn-card.tsx';
import { BackButton } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { CredentialField } from './credential-field.tsx';
import { type CredentialSection, groupCredentials } from './credentials-model.ts';
import { PageHeader } from '../ui/page-header.tsx';

/** Tela dedicada às chaves e tokens. Segredos nunca voltam do servidor: aparecem só como "configurada ••••1234". */
export function CredentialsPage() {
  const [sections, setSections] = useState<CredentialSection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    listCredentials()
      .then(({ groups, fields }) => {
        if (seq === loadSeq.current) setSections(groupCredentials(fields, groups));
      })
      .catch(() => {
        if (seq === loadSeq.current) setFailed(true);
      });
  }, []);

  useEffect(() => {
    load();
    // Invalida respostas em voo ao sair da tela.
    return () => {
      loadSeq.current++;
    };
  }, [load]);

  if (failed && !sections) return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar as credenciais" />;

  return (
    <>
      <PageHeader
        leading={<BackButton label="Voltar" fallback="/settings" />}
        title="Credenciais"
        description={
          <>
            Chaves e tokens dos serviços. Ficam só no <code>.env</code> deste computador (acesso restrito ao seu usuário) e nunca voltam para a tela.
          </>
        }
      />
      {sections === null ? (
        <Skeleton label="carregando credenciais" rows={6} />
      ) : (
        <div className="conn-grid">
          {sections.map((s) => (
            <ConnCard key={s.id} icon="key" title={s.label} description={null}>
              {s.fields.map((f) => (
                // Muda o estado salvo = campo novo: o valor exibido e os botões voltam ao que o servidor diz.
                <CredentialField key={`${f.key}:${f.configured}:${f.value ?? ''}:${f.hint ?? ''}`} field={f} onChanged={load} />
              ))}
            </ConnCard>
          ))}
        </div>
      )}
    </>
  );
}
