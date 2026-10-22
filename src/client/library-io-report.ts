import type { LibraryCsvReport, MalImportReport } from './api.ts';

/** Quantos problemas mostrar de uma vez: um arquivo grande com centenas de erros não deve empurrar a tela. */
export const REPORT_PROBLEM_LIMIT = 50;

export interface ReportLines {
  summary: string;
  /** Explicação extra quando faz sentido (ex.: entradas do MAL que ficaram de fora). */
  note?: string;
  problems: string[];
}

const capped = (problems: string[]): string[] => {
  if (problems.length <= REPORT_PROBLEM_LIMIT) return problems;
  const rest = problems.length - REPORT_PROBLEM_LIMIT;
  return [...problems.slice(0, REPORT_PROBLEM_LIMIT), `e mais ${rest} ${rest === 1 ? 'linha' : 'linhas'} com erro`];
};

export const csvReportLines = (report: LibraryCsvReport): ReportLines => ({
  summary: `${report.imported} novos · ${report.updated} atualizados · ${report.unchanged} sem mudança · ${report.failed} com erro`,
  problems: capped(report.errors.map((e) => `linha ${e.row}: ${e.message}`)),
});

export const malReportLines = (report: MalImportReport): ReportLines => {
  const unresolved = report.unresolved.map((u) => {
    const name = u.title ? `, ${u.title}` : '';
    return `entrada ${u.row} (id MAL ${u.malId}${name}): sem título correspondente na biblioteca`;
  });
  const lines: ReportLines = {
    summary: `${report.entries} entradas lidas · ${report.imported} novas · ${report.updated} atualizadas · ${report.unresolved.length} sem correspondência`,
    problems: capped([...unresolved, ...report.errors.map((e) => `entrada ${e.row}: ${e.message}`)]),
  };
  if (report.unresolved.length > 0) {
    lines.note = 'O MyAnimeList usa ids próprios e este app não tem como convertê-los offline, então essas entradas não entram. Veja docs/providers/importers.md.';
  }
  return lines;
};
