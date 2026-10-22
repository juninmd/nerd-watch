import { renderTelegramSettings } from '../components/telegram-settings.ts';

/** Esqueleto da central de conexões; a Fase 2 troca o conteúdo pelos cartões de status e pelo login guiado. */
export const renderConnections = (host: HTMLElement, _query: URLSearchParams): void => {
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Conexões</h1>
      <p class="view-subtitle">Tudo que o app usa de fora, num lugar só: o que está ligado, o que falta e como resolver.</p>
    </header>
    <div id="tg-settings-host"></div>
  `;
  renderTelegramSettings(host.querySelector('#tg-settings-host') as HTMLElement);
};
