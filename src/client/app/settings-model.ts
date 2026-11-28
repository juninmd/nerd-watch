/** Textos da tela Ajustes que dependem do estado do servidor. Sem DOM, para ser testável. */
export const notifySummary = (enabled: boolean, leadDays: number): string => {
  if (!enabled) return 'Desligados. Configure um destino no .env (webhook, ntfy, Discord ou Telegram) para receber um aviso por lançamento.';
  if (leadDays <= 0) return 'Ligados: você recebe o aviso no dia do lançamento.';
  return `Ligados: você recebe o aviso ${leadDays} dia${leadDays === 1 ? '' : 's'} antes do lançamento.`;
};

/** Cartões da tela Ajustes com as palavras que a busca reconhece (inclui sinônimos comuns). */
export const SETTINGS_SECTIONS = [
  { id: 'theme', words: 'tema aparência escuro claro sistema cores modo noturno' },
  { id: 'shortcuts', words: 'atalhos teclado paleta ctrl k comandos' },
  { id: 'notify', words: 'avisos lançamento notificações webhook ntfy discord telegram alerta' },
  { id: 'version', words: 'versão atualização baixar update release' },
  { id: 'report', words: 'relatar problema bug erro issue github suporte' },
  { id: 'session', words: 'sessão sair logout token acesso login' },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

/** Todas as palavras digitadas precisam aparecer (prefixo basta), sem diferenciar acento ou caixa. */
export const matchSettings = (query: string): Set<SettingsSection> => {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  return new Set(
    SETTINGS_SECTIONS.filter((s) => {
      const words = fold(s.words).split(' ');
      return terms.every((t) => words.some((w) => w.startsWith(t)));
    }).map((s) => s.id),
  );
};
