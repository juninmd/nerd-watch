import type { StatsSummary } from '../../server/stats/summary.ts';
import { getStats } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { yearOptions } from '../stats/model.ts';
import { renderBody } from '../stats/render.ts';
import { shareCardPng } from '../stats/share-card.ts';
import { shareCardModel } from '../stats/share-model.ts';

/** Ritmo da fila (horas por dia): preferência do navegador, então fica em localStorage (com try/catch). */
const HPD_OPTIONS = [0.5, 1, 2, 3, 4];
const HPD_KEY = 'nw:stats-hpd';
const DEFAULT_HPD = 1;

const readHpd = (): number => {
  try {
    const v = Number(localStorage.getItem(HPD_KEY));
    return HPD_OPTIONS.includes(v) ? v : DEFAULT_HPD;
  } catch {
    return DEFAULT_HPD;
  }
};

const saveHpd = (v: number): void => {
  try {
    localStorage.setItem(HPD_KEY, String(v));
  } catch {
    // sem armazenamento (aba privada): a escolha vale só nesta tela
  }
};

const parseYear = (raw: string | null): number | null => {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= 1970 && y <= 2100 ? y : null;
};

const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Chave de corrida: só a resposta mais recente aparece (trocar de ano depressa não mistura números). */
let loadSeq = 0;

/**
 * Tooltip único por tela, mostrado em hover e em foco de teclado. Lê `data-tip` das marcas do gráfico, então o
 * que aparece para o mouse é exatamente o que o leitor de tela anuncia no aria-label.
 */
const attachTooltips = (root: HTMLElement): void => {
  const tip = document.createElement('div');
  tip.className = 'stat-tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  root.append(tip);

  const show = (el: Element): void => {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    const box = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    tip.textContent = text;
    tip.style.left = `${r.left - box.left + r.width / 2}px`;
    tip.style.top = `${r.top - box.top}px`;
    tip.hidden = false;
  };
  const hide = (): void => {
    tip.hidden = true;
  };
  root.addEventListener('pointerover', (e) => {
    const t = (e.target as Element).closest?.('[data-tip]');
    if (t) show(t);
  });
  root.addEventListener('pointerout', (e) => {
    if ((e.target as Element).closest?.('[data-tip]')) hide();
  });
  root.addEventListener('focusin', (e) => {
    const t = (e.target as Element).closest?.('[data-tip]');
    if (t) show(t);
  });
  root.addEventListener('focusout', hide);
};

/** Cartão "Meu ano" em diálogo: PNG gerado no navegador, com baixar. Nada é enviado a lugar nenhum. */
const openShareCard = (s: StatsSummary): void => {
  const model = shareCardModel(s);
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog stats-share';
  dlg.setAttribute('closedby', 'any');
  dlg.setAttribute('aria-labelledby', 'share-title');
  dlg.innerHTML = `
    <form method="dialog" class="dialog-head"><h2 id="share-title">${icon('chart')} Meu ano em ${s.year}</h2>
      <button class="btn btn-ghost btn-sm" aria-label="fechar">${icon('x', 'sm')}</button></form>
    <p class="stat-hint">Cartão gerado no seu navegador. Traz só totais do ano, nota média e gênero mais visto: nenhum título nem anotação.</p>
    <p class="stat-hint" role="status" id="share-status">Gerando cartão…</p>
    <img class="stats-share-img" id="share-img" alt="" hidden>
    <div class="stats-share-actions"><a class="btn btn-primary" id="share-download" download="nerd-watch-${s.year}.png" hidden>Baixar PNG</a></div>`;
  document.body.appendChild(dlg);
  dlg.showModal();

  const status = dlg.querySelector('#share-status') as HTMLElement;
  const img = dlg.querySelector('#share-img') as HTMLImageElement;
  const link = dlg.querySelector('#share-download') as HTMLAnchorElement;
  let url: string | null = null;
  dlg.addEventListener('close', () => {
    if (url) URL.revokeObjectURL(url);
    dlg.remove();
  });

  shareCardPng(model)
    .then((blob) => {
      url = URL.createObjectURL(blob);
      img.src = url;
      img.alt = `Cartão do ano ${s.year}: ${model.headline}`;
      img.hidden = false;
      link.href = url;
      link.hidden = false;
      status.textContent = 'Pronto. Baixe o PNG para compartilhar.';
    })
    .catch(() => {
      status.textContent = 'Não foi possível gerar o cartão neste navegador.';
    });
};

/** Tela de estatísticas: seletor de ano (na URL, para voltar e compartilhar o link), ritmo da fila e o resumo. */
export const renderStats = (host: HTMLElement, query: URLSearchParams): void => {
  const currentYear = new Date().getFullYear();
  const year = parseYear(query.get('year')) ?? currentYear;
  const tz = browserTimeZone();
  let hpd = readHpd();

  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Estatísticas</h1>
      <p class="view-subtitle">Seu ano na lista: conclusões, tempo, gêneros e notas. Calculado no seu aparelho a partir do histórico.</p>
    </header>
    <div class="stats-toolbar" role="group" aria-label="Filtros das estatísticas">
      <label class="stats-field">Ano
        <select id="stats-year"><option value="${year}" selected>${year}</option></select>
      </label>
      <label class="stats-field">Ritmo da fila
        <select id="stats-hpd">${HPD_OPTIONS.map((h) => `<option value="${h}"${h === hpd ? ' selected' : ''}>${h.toString().replace('.', ',')} h por dia</option>`).join('')}</select>
      </label>
      <button class="btn btn-ghost btn-sm" id="stats-share" type="button">${icon('download', 'sm')} Compartilhar ano</button>
    </div>
    <div class="stats-root" id="stats-root" aria-live="polite" aria-busy="true"><div id="stats-body"><div class="skeleton" style="height:200px" aria-hidden="true"></div></div></div>`;

  const root = host.querySelector('#stats-root') as HTMLElement;
  const body = host.querySelector('#stats-body') as HTMLElement;
  attachTooltips(root);
  const yearSelect = host.querySelector('#stats-year') as HTMLSelectElement;
  const hpdSelect = host.querySelector('#stats-hpd') as HTMLSelectElement;
  let latest: StatsSummary | null = null;

  yearSelect.addEventListener('change', () => navigate(`/estatisticas?year=${yearSelect.value}`));
  hpdSelect.addEventListener('change', () => {
    hpd = Number(hpdSelect.value);
    saveHpd(hpd);
    load();
  });
  host.querySelector('#stats-share')?.addEventListener('click', () => {
    if (latest) openShareCard(latest);
  });

  const load = (): void => {
    const token = ++loadSeq;
    getStats({ year, tz, hpd })
      .then((s) => {
        if (token !== loadSeq) return;
        latest = s;
        const years = yearOptions(s.firstYear, currentYear);
        if (!years.includes(year)) years.unshift(year);
        yearSelect.innerHTML = years
          .map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`)
          .join('');
        body.innerHTML = renderBody(s);
        root.setAttribute('aria-busy', 'false');
      })
      .catch((err: unknown) => {
        if (token !== loadSeq) return;
        const msg = err instanceof Error ? err.message : 'erro desconhecido';
        root.setAttribute('aria-busy', 'false');
        body.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>Não foi possível carregar as estatísticas (${escapeHtml(msg)}).</div>`;
      });
  };
  load();
};
