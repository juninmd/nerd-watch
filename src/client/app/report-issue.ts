import { resolveVersionStatus } from '../platform/version-info.ts';
import { currentRoute } from './router.ts';

const NEW_ISSUE_URL = 'https://github.com/juninmd/nerd-watch/issues/new';

export interface ReportInfo {
  version: string | null;
  installed: boolean;
  /** Só o caminho da tela: a query pode ter termo de busca ou id e fica de fora. */
  route: string;
  userAgent: string;
}

/**
 * Link de issue já preenchido com versão, tela e navegador. Nada é enviado sozinho: a pessoa revisa no GitHub.
 */
export const reportIssueUrl = (info: ReportInfo): string => {
  const body = [
    '## O que aconteceu',
    '',
    '## O que era esperado',
    '',
    '## Passos para reproduzir',
    '1. ',
    '',
    '## Ambiente',
    `- Versão: ${info.version ? `v${info.version}` : 'desconhecida'} (${info.installed ? 'app desktop' : 'servidor/navegador'})`,
    `- Tela: ${info.route.split('?')[0]}`,
    `- Navegador: ${info.userAgent}`,
  ].join('\n');
  return `${NEW_ISSUE_URL}?${new URLSearchParams({ labels: 'bug', body }).toString()}`;
};

export const openReportIssue = async (): Promise<void> => {
  const status = await resolveVersionStatus().catch(() => null);
  const url = reportIssueUrl({
    version: status?.version ?? null,
    installed: status?.installed ?? false,
    route: currentRoute().path,
    userAgent: navigator.userAgent,
  });
  window.open(url, '_blank', 'noopener,noreferrer');
};
