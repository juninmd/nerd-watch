import { icon } from '../icons.ts';
import { navigate } from '../router.ts';

const LOADING = '<div class="skeleton" style="height:320px;border-radius:20px"></div>';

/**
 * Erro ao carregar um título: a tela não fica sem saída. "Voltar" usa o histórico
 * (ou vai para o Início se a aba começou aqui) e "tentar de novo" refaz a requisição.
 * A mensagem é fixa: o texto do servidor (ex.: "parâmetros inválidos") não é para o usuário.
 */
export const renderTitleError = (host: HTMLElement, retry: () => void): void => {
  host.innerHTML = `
    <div class="empty-state" role="alert">
      <div class="big">${icon('alert')}</div>
      <p>não foi possível carregar este título</p>
      <div class="chip-row title-error-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-back>voltar</button>
        <button type="button" class="btn btn-primary btn-sm" data-retry>tentar de novo</button>
      </div>
    </div>`;
  host.querySelector('[data-back]')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else navigate('/');
  });
  host.querySelector('[data-retry]')?.addEventListener('click', () => {
    host.innerHTML = LOADING;
    retry();
  });
};
