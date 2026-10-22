/** Medidas de uma área rolável (as mesmas de um elemento DOM), para a lógica de rolagem ser testável sem navegador. */
export interface ScrollMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** Quanto cada clique anda: quase uma tela, deixando o próximo cartão parcialmente à vista como pista de que há mais. */
export const pageStep = (clientWidth: number): number => Math.max(1, Math.round(clientWidth * 0.9));

/** Posição de destino de um clique nas setas, sem passar dos extremos. */
export const scrollTarget = (m: ScrollMetrics, direction: -1 | 1): number => {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  return Math.min(max, Math.max(0, m.scrollLeft + direction * pageStep(m.clientWidth)));
};

/** Início e fim da rolagem, com 1px de tolerância (o `scrollLeft` costuma vir fracionado em telas com zoom). */
export const edges = (m: ScrollMetrics): { atStart: boolean; atEnd: boolean } => ({
  atStart: m.scrollLeft <= 1,
  atEnd: m.scrollLeft >= m.scrollWidth - m.clientWidth - 1,
});

/** Índice do cartão vizinho para as setas do teclado: para nas pontas e não inventa posição se o foco não está em um cartão. */
export const siblingIndex = (current: number, count: number, direction: -1 | 1): number => {
  if (current < 0 || count === 0) return -1;
  return Math.min(count - 1, Math.max(0, current + direction));
};
