/** Textos da tela Ajustes que dependem do estado do servidor. Sem DOM, para ser testável. */
export const notifySummary = (enabled: boolean, leadDays: number): string => {
  if (!enabled) return 'Desligados. Configure um destino no .env (webhook, ntfy, Discord ou Telegram) para receber um aviso por lançamento.';
  if (leadDays <= 0) return 'Ligados: você recebe o aviso no dia do lançamento.';
  return `Ligados: você recebe o aviso ${leadDays} dia${leadDays === 1 ? '' : 's'} antes do lançamento.`;
};
