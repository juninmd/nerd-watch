import { navigate } from '../app/router.ts';
import { icon } from './icons.ts';

/** Botão "voltar" padrão das telas de detalhe. `data-back` é o gancho de `wireBackButton`. */
export const backButtonHtml = (label = 'voltar'): string => `<button type="button" class="btn btn-ghost btn-sm back-btn" data-back>${icon('back', 'sm')} ${label}</button>`;

/** Volta no histórico; se a aba começou nesta tela, vai para `fallback` em vez de sair do app. */
export const wireBackButton = (host: HTMLElement, fallback = '/'): void => {
  host.querySelector('[data-back]')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else navigate(fallback);
  });
};
