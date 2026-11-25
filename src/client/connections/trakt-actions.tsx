import { Button, Card, ConfirmButton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { json } from '../api/index.ts';
import { listSources } from '../api/sources.ts';
import { Icon } from '../ui/icon.tsx';

interface ImportSummary {
  imported: number;
  updated: number;
  unchanged: number;
  skippedNoTmdb: number;
  failed: number;
}

interface ExportSummary {
  exported: number;
  alreadyInTrakt: number;
  skippedNoTmdb: number;
  notFound: number;
}

const post = (path: string, body: unknown = {}): Promise<Response> =>
  fetch(`/api/trakt${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const importSummary = (s: ImportSummary): string =>
  `Importado: ${s.imported} novos, ${s.updated} atualizados, ${s.unchanged} já estavam certos. Ignorados: ${s.skippedNoTmdb} sem TMDB${s.failed ? `, ${s.failed} com falha` : ''}.`;

const exportSummary = (s: ExportSummary): string =>
  `Enviado: ${s.exported} itens. Já estavam no Trakt: ${s.alreadyInTrakt}. Ignorados: ${s.skippedNoTmdb} sem id TMDB${s.notFound ? `, ${s.notFound} não reconhecidos pelo Trakt` : ''}.`;

const EXPORT_CONFIRM =
  'Enviar o que você marcou como assistido aqui para o seu histórico do Trakt? ' +
  'Isto ESCREVE na sua conta Trakt: os filmes e séries marcados como assistidos no nerd-watch que ainda não estão lá serão adicionados. ' +
  'Itens já presentes não são reenviados. Para desfazer, remova a entrada direto no Trakt.';

/** Ações do Trakt abaixo do cartão genérico: só aparecem com a conta conectada. `version` muda = reavaliar a conexão. */
export function TraktActions({ version }: { version: number }) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    void version;
    listSources()
      .catch(() => [])
      .then((sources) => {
        if (alive) setConnected(sources.find((s) => s.id === 'trakt')?.connected === true);
      });
    return () => {
      alive = false;
    };
  }, [version]);

  /** Uma importação/exportação por vez. Erro do servidor é nosso (sem corpo cru do Trakt): mostra a mensagem como está. */
  const run = async <T,>(path: string, body: unknown, render: (value: T) => string): Promise<void> => {
    setBusy(true);
    setStatus('Trabalhando…');
    try {
      setStatus(render(await json<T>(await post(path, body))));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'não foi possível concluir agora');
    } finally {
      setBusy(false);
    }
  };

  if (!connected) return null;
  return (
    <Card className="conn-card" padding="lg">
      <div className="conn-actions">
        <Button variant="primary" iconStart={<Icon name="download" size="sm" />} disabled={busy} onClick={() => void run<ImportSummary>('/import', undefined, importSummary)}>
          Importar do Trakt
        </Button>
        <ConfirmButton
          variant="ghost"
          disabled={busy}
          iconStart={<Icon name="upload" size="sm" />}
          ask={EXPORT_CONFIRM}
          confirmLabel="Enviar"
          onConfirm={() => void run<ExportSummary>('/export', { confirm: true }, exportSummary)}
        >
          Enviar o que assisti ao Trakt
        </ConfirmButton>
      </div>
      <p className="hint" role="status" aria-live="polite">
        {status}
      </p>
    </Card>
  );
}
