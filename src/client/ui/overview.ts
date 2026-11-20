export const overviewEl = (text: string | null | undefined): HTMLElement => {
  const p = document.createElement('div');
  p.className = 'overview';
  p.textContent = text || 'Sem sinopse.';
  return p;
};
