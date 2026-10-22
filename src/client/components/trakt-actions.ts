import { json } from '../api.ts';
import { icon } from '../icons.ts';
import { listSources } from '../source-api.ts';

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
  fetch(`/api/trakt${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const importSummary = (s: ImportSummary): string =>
  `Importado: ${s.imported} novos, ${s.updated} atualizados, ${s.unchanged} já estavam certos. Ignorados: ${s.skippedNoTmdb} sem TMDB${s.failed ? `, ${s.failed} com falha` : ''}.`;

const exportSummary = (s: ExportSummary): string =>
  `Enviado: ${s.exported} itens. Já estavam no Trakt: ${s.alreadyInTrakt}. Ignorados: ${s.skippedNoTmdb} sem id TMDB${s.notFound ? `, ${s.notFound} não reconhecidos pelo Trakt` : ''}.`;

const EXPORT_CONFIRM =
  'Enviar o que você marcou como assistido aqui para o seu histórico do Trakt?\n\n' +
  'Isto ESCREVE na sua conta Trakt: os filmes e séries marcados como assistidos no nerd-watch que ainda não estão lá serão adicionados. ' +
  'Itens já presentes não são reenviados. Para desfazer, remova a entrada direto no Trakt.';

/** Erro do servidor é nosso (sem corpo cru do Trakt): mostra a mensagem como está. */
const run = async <T>(path: string, body: unknown, render: (value: T) => string, status: HTMLElement): Promise<void> => {
  status.textContent = 'Trabalhando…';
  try {
    const value = await json<T>(await post(path, body));
    status.textContent = render(value);
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : 'não foi possível concluir agora';
  }
};

const draw = (host: HTMLElement): void => {
  host.innerHTML = `
    <div class="conn-actions">
      <button class="btn btn-primary" data-act="import" type="button">${icon('download', 'sm')} Importar do Trakt</button>
      <button class="btn btn-ghost" data-act="export" type="button">${icon('upload', 'sm')} Enviar o que assisti ao Trakt</button>
    </div>
    <p class="hint" role="status" aria-live="polite"></p>`;
  const status = host.querySelector<HTMLElement>('[role="status"]') as HTMLElement;
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];

  // Desabilita os dois botões durante a operação: uma importação/exportação por vez.
  const busy = (task: Promise<void>) => {
    for (const b of buttons) b.disabled = true;
    return task.finally(() => {
      for (const b of buttons) b.disabled = false;
    });
  };

  host.querySelector<HTMLButtonElement>('[data-act="import"]')?.addEventListener('click', () => {
    void busy(run<ImportSummary>('/import', undefined, importSummary, status));
  });

  host.querySelector<HTMLButtonElement>('[data-act="export"]')?.addEventListener('click', () => {
    if (!confirm(EXPORT_CONFIRM)) return;
    void busy(run<ExportSummary>('/export', { confirm: true }, exportSummary, status));
  });
};

/** Ações do Trakt abaixo do cartão genérico: só aparecem com a conta conectada. */
export const mountTraktActions = async (host: HTMLElement): Promise<void> => {
  const trakt = (await listSources().catch(() => [])).find((s) => s.id === 'trakt');
  if (!trakt?.connected) {
    host.innerHTML = '';
    return;
  }
  draw(host);
};
