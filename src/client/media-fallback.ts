import { fetchPlan, fetchPrepStatus, liveUrl, type PlanDto, type PrepStatus, preparedFileUrl, startPrepare } from './media-api.ts';
import { PATH_LABEL } from './media-seek.ts';
import { playTranscoded } from './media-shim.ts';

/**
 * Formato que o navegador não toca: antes de tentar o arquivo cru, pergunta ao servidor o caminho (direto, remux,
 * transcodificado ou indisponível) e aplica. O selo com o caminho usado fica no palco.
 *
 * Race: o `error` do arquivo cru pode chegar antes da resposta do plano. Por isso plano e conversão são
 * "single-flight" por item: quem chega depois reaproveita o que já está em curso, em vez de abrir outra conversão.
 */

export interface MediaItem {
  key: string;
  channelId: string;
  messageId: string;
}

export interface FallbackOptions {
  /** Posição salva do vídeo (segundos), para retomar depois da conversão. */
  resumeAt: number | null;
  /** O item ainda é o que está tocando? Falso aborta os laços de espera. */
  isCurrent(): boolean;
  onMessage(text: string): void;
}

const POLL_MS = 700;
const MAX_ATTEMPTS = 2;
const MAX_MEMO = 200;
const FAILED = 'não foi possível reproduzir esse vídeo';
const BUSY = 'todos os processos de conversão estão ocupados; tente de novo em instantes';

const plans = new Map<string, Promise<PlanDto | null>>();
const flows = new Map<string, Promise<void>>();
const attempts = new Map<string, number>();

const remember = <T>(map: Map<string, T>, key: string, value: T): void => {
  if (map.size >= MAX_MEMO) map.delete(map.keys().next().value as string);
  map.set(key, value);
};

const planFor = (item: MediaItem): Promise<PlanDto | null> => {
  let plan = plans.get(item.key);
  if (!plan) {
    // Falha transitória não fica memorizada: o próximo carregamento tenta de novo.
    plan = fetchPlan(item.channelId, item.messageId).catch(() => {
      plans.delete(item.key);
      return null;
    });
    remember(plans, item.key, plan);
  }
  return plan;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Um só selo, movido para o pai atual do `<video>` (palco da página ou barra fixa). */
const badge = (): HTMLElement => {
  let el = document.querySelector<HTMLElement>('.media-badge');
  if (!el) {
    el = document.createElement('span');
    el.className = 'media-badge';
    el.setAttribute('role', 'status');
  }
  return el;
};

const setBadge = (video: HTMLVideoElement, text: string, title = ''): void => {
  const el = badge();
  const host = video.parentElement;
  if (host && el.parentElement !== host) {
    host.classList.add('media-host');
    host.appendChild(el);
  }
  el.textContent = text;
  el.title = title;
  el.hidden = text === '';
};

const progressText = (s: PrepStatus): string => `Preparando… ${Math.round(s.progress * 100)}%`;

/** Espera a conversão terminar, com progresso no selo. `false` quando não ficou pronta (o erro já foi mostrado). */
const waitReady = async (item: MediaItem, video: HTMLVideoElement, opts: FallbackOptions): Promise<boolean> => {
  let status: PrepStatus | 'busy' = await startPrepare(item.channelId, item.messageId);
  for (;;) {
    if (!opts.isCurrent()) return false;
    if (status === 'busy') {
      opts.onMessage(BUSY);
      setBadge(video, '');
      return false;
    }
    if (status.state === 'ready') return true;
    if (status.state === 'error') {
      opts.onMessage(status.error ?? FAILED);
      setBadge(video, '');
      return false;
    }
    setBadge(video, progressText(status));
    await sleep(POLL_MS);
    // "idle": o job sumiu (ex.: cache apagado no meio). Pede de novo em vez de ficar girando.
    status = status.state === 'idle' ? await startPrepare(item.channelId, item.messageId) : await fetchPrepStatus(item.channelId, item.messageId);
  }
};

const convert = async (item: MediaItem, video: HTMLVideoElement, plan: PlanDto, opts: FallbackOptions): Promise<void> => {
  if (plan.path === 'transcode') {
    playTranscoded(video, liveUrl(item.channelId, item.messageId), opts.resumeAt ?? 0, plan.durationSeconds);
    setBadge(video, PATH_LABEL.transcode, 'Transcodificado ao vivo; a barra de posição mostra o vídeo inteiro.');
    void video.play().catch(() => undefined);
    return;
  }
  if (!(await waitReady(item, video, opts)) || !opts.isCurrent()) return;
  video.setAttribute('src', preparedFileUrl(item.channelId, item.messageId));
  const resumeAt = opts.resumeAt;
  if (resumeAt !== null) {
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (resumeAt < video.duration) video.currentTime = resumeAt;
      },
      { once: true },
    );
  }
  setBadge(video, PATH_LABEL.remux, 'Convertido sem perda de qualidade (remux) e salvo em cache no servidor.');
  void video.play().catch(() => undefined);
};

/** Uma conversão por item por vez. Ao terminar (ok ou erro) sai do mapa, então o próximo erro pode tentar de novo. */
const startFlow = (item: MediaItem, video: HTMLVideoElement, plan: PlanDto, opts: FallbackOptions): void => {
  // Falha de rede ou resposta de erro do servidor vira aviso, nunca promessa rejeitada sem ninguém ouvindo.
  const flow = convert(item, video, plan, opts)
    .catch(() => opts.onMessage(FAILED))
    .finally(() => flows.delete(item.key));
  remember(flows, item.key, flow);
};

/**
 * Chamado quando um item começa a tocar. Direto, sem pasta local: só o selo. Indisponível: o selo com o motivo (o
 * arquivo cru segue e, se falhar, o erro mostra o motivo). Remux ou transcodificação: troca o `src` sem esperar o erro.
 */
export const prepareForItem = async (item: MediaItem, video: HTMLVideoElement, opts: FallbackOptions): Promise<void> => {
  const plan = await planFor(item);
  if (!opts.isCurrent()) return;
  if (!plan || plan.path === 'n/a') return setBadge(video, '');
  if (plan.path === 'direct') return setBadge(video, PATH_LABEL.direct);
  if (plan.path === 'unavailable') return setBadge(video, PATH_LABEL.unavailable, plan.reason ?? '');
  if (!flows.has(item.key)) startFlow(item, video, plan, opts);
};

/**
 * Erro do `<video>`. Devolve `false` quando o item é direto ou sem pasta local: vale o tratamento antigo (mensagem do
 * servidor, embed). Devolve `true` quando este módulo cuidou do erro (conversão em curso, motivo, ou teto de tentativas).
 */
export const handleUnplayable = async (item: MediaItem, video: HTMLVideoElement, opts: FallbackOptions): Promise<boolean> => {
  const plan = await planFor(item);
  if (!plan || plan.path === 'direct' || plan.path === 'n/a') return false;
  if (!opts.isCurrent()) return true;
  if (plan.path === 'unavailable') {
    opts.onMessage(plan.reason ?? FAILED);
    return true;
  }
  if (flows.has(item.key)) return true;
  const tries = attempts.get(item.key) ?? 0;
  if (tries >= MAX_ATTEMPTS) {
    opts.onMessage(FAILED);
    return true;
  }
  remember(attempts, item.key, tries + 1);
  startFlow(item, video, plan, opts);
  return true;
};
