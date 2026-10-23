import { type SubtitleSearchResponse, searchSubtitles } from '../api.ts';
import { decodeSubtitleBytes } from '../../shared/subtitles/decode.ts';
import { toWebVtt } from '../../shared/subtitles/srt-vtt.ts';
import { type CaptionStyle, captionPrefs } from '../player-captions-prefs.ts';
import {
  canSearch,
  type CaptionContext,
  firstPerLanguage,
  LOCAL_OPTION,
  OFF,
  preferredOption,
  toggleDecision,
} from '../player-captions-model.ts';
import { formatOffset, nextOffset } from '../player-captions-offset.ts';
import {
  archiveOption,
  type CaptionOption,
  DISABLED_TEXT,
  errorText,
  localFailure,
  resultOption,
} from './player-captions-options.ts';
import { applyCaptionStyle, createTrackSlot } from './player-captions-track.ts';
import { type CaptionsViewModel, createCaptionsView } from './player-captions-view.ts';

/**
 * Legendas do player: liga um `<track>` com o WebVTT no `<video>`, guarda a escolha, aplica o atraso e o
 * estilo. A busca e o download passam pelo servidor. As opções e o `<track>` ficam em módulos próprios.
 */

/** Mesmo teto do servidor: arquivo maior que isso não é legenda de filme. */
const LOCAL_MAX_BYTES = 2 * 1024 * 1024;

export interface CaptionsHost {
  video(): HTMLVideoElement | null;
  /** Onde o menu mora agora: a barra fixa ou o palco da tela de reprodução. Null quando o player está fechado. */
  host(): HTMLElement | null;
}

export interface Captions {
  /** Novo vídeo: esquece a escolha anterior e, se há preferência de idioma, busca e liga essa legenda. */
  load(ctx: CaptionContext | null): void;
  /** Tecla "c". */
  toggle(): void;
  clear(): void;
  repaint(): void;
}

export const mountCaptions = (opts: CaptionsHost): Captions => {
  const slot = createTrackSlot();
  let ctx: CaptionContext | null = null;
  let archive: CaptionOption | null = null;
  let searchOptions: CaptionOption[] = [];
  let local: CaptionOption | null = null;
  let options: CaptionOption[] = [];
  let searchState: 'idle' | 'busy' | 'done' | 'disabled' | 'empty' | 'error' = 'idle';
  let message = '';
  let current: string = OFF;
  let lastChoice: string | null = null;
  let offsetMs = 0;
  let busy = false;
  let token = 0;
  let style: CaptionStyle = captionPrefs.style();

  const video = (): HTMLVideoElement | null => opts.video();
  const announce = (text: string): void => view.announce(text);

  const rebuild = (): void => {
    options = [archive, ...searchOptions, local].filter((o): o is CaptionOption => o !== null);
  };

  const paint = (): void => {
    const vm: CaptionsViewModel = {
      current,
      currentLabel: options.find((o) => o.id === current)?.label ?? 'desligadas',
      options: options.map(({ id, label, detail }) => ({ id, label, detail })),
      canSearch: canSearch(ctx),
      searchBusy: searchState === 'busy' || busy,
      message: busy ? 'Carregando legenda…' : message,
      offsetMs,
      style,
    };
    view.render(vm);
  };

  const fail = (text: string): void => {
    busy = false;
    message = text;
    announce(text);
    paint();
  };

  /**
   * Escolha nova: a legenda anterior sai já, então o menu nunca mostra uma e toca outra. Se a carga atrasar,
   * a versão mais recente da escolha é a que fica (o token descarta as antigas).
   */
  const select = async (id: string): Promise<void> => {
    const mine = ++token;
    slot.drop();
    if (id === OFF) {
      current = OFF;
      message = '';
      busy = false;
      announce('Legendas desligadas');
      paint();
      return;
    }
    const option = options.find((o) => o.id === id);
    const el = video();
    if (!option || !el) return;
    current = OFF;
    busy = true;
    message = '';
    announce(`Carregando legenda: ${option.label}`);
    paint();
    let vtt: string;
    try {
      vtt = await option.load();
    } catch (err) {
      if (mine === token) fail(errorText(err));
      return;
    }
    if (mine !== token) return;
    const track = await slot.attach(el, vtt, option.label, option.code, offsetMs);
    // Outra escolha começou enquanto esta montava: a faixa que sobrou aqui não pode ficar tocando.
    if (mine !== token) {
      if (track) slot.dropIf(track);
      return;
    }
    if (!track) return fail('não foi possível usar esta legenda');
    busy = false;
    current = id;
    lastChoice = id;
    if (option.code) captionPrefs.setLanguage(option.code);
    announce(`Legendas: ${option.label}`);
    paint();
  };

  const runSearch = async (): Promise<void> => {
    const forCtx = ctx;
    if (!forCtx || !canSearch(forCtx)) return;
    searchState = 'busy';
    message = '';
    paint();
    let data: SubtitleSearchResponse;
    try {
      data = await searchSubtitles({
        query: forCtx.query,
        tmdbId: forCtx.tmdbId,
        mediaType: forCtx.mediaType,
        season: forCtx.season ?? null,
        episode: forCtx.episode ?? null,
      });
    } catch {
      if (ctx !== forCtx) return;
      searchState = 'error';
      message = 'não foi possível buscar legendas agora';
      rebuild();
      paint();
      return;
    }
    if (ctx !== forCtx) return;
    if (!data.enabled) {
      searchState = 'disabled';
      message = DISABLED_TEXT[data.reason ?? ''] ?? 'Busca de legenda indisponível.';
      searchOptions = [];
    } else if (data.results.length === 0) {
      searchState = 'empty';
      message = 'nenhuma legenda encontrada para este título';
      searchOptions = [];
    } else {
      searchState = 'done';
      searchOptions = firstPerLanguage(data.results).map((r) => resultOption(r, data.imdbId, forCtx));
    }
    rebuild();
    paint();
  };

  const pickFile = async (file: File): Promise<void> => {
    if (file.size > LOCAL_MAX_BYTES) return fail('arquivo grande demais para legenda (limite de 2 MB)');
    const startedFor = ctx;
    const startedToken = token;
    let vtt: string;
    try {
      const converted = toWebVtt(decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer())));
      if (!converted.ok) return fail(`não foi possível usar este arquivo: ${localFailure(converted.reason)}`);
      vtt = converted.vtt;
    } catch {
      return fail('não foi possível ler este arquivo');
    }
    // O vídeo pode ter trocado durante a leitura: esse arquivo não é da legenda do vídeo novo.
    if (ctx !== startedFor || token !== startedToken) return;
    local = {
      id: LOCAL_OPTION,
      label: file.name.slice(0, 60),
      detail: 'arquivo do seu aparelho',
      code: null,
      load: () => Promise.resolve(vtt),
    };
    rebuild();
    await select(LOCAL_OPTION);
  };

  const changeOffset = (delta: number | 'reset'): void => {
    offsetMs = delta === 'reset' ? 0 : nextOffset(offsetMs, delta);
    slot.shift(offsetMs);
    announce(`Sincronia da legenda: ${formatOffset(offsetMs)}`);
    paint();
  };

  const setStyle = (next: CaptionStyle): void => {
    style = next;
    captionPrefs.setStyle(next);
    applyCaptionStyle(video(), style);
    paint();
  };

  const view = createCaptionsView({
    select: (id) => void select(id),
    search: () => void runSearch(),
    pickFile: (file) => void pickFile(file),
    offset: changeOffset,
    style: setStyle,
  });

  const resetState = (next: CaptionContext | null): void => {
    ctx = next;
    archive = next?.archiveId && next.archiveHasSubtitle ? archiveOption(next.archiveId) : null;
    searchOptions = [];
    local = null;
    searchState = 'idle';
    message = '';
    current = OFF;
    lastChoice = null;
    offsetMs = 0;
    busy = false;
    rebuild();
  };

  const load = (next: CaptionContext | null): void => {
    token++;
    const mineAtLoad = token;
    slot.drop();
    resetState(next);
    paint();
    const language = captionPrefs.language();
    if (next && canSearch(next) && language) {
      void runSearch().then(() => {
        // Se o usuário escolheu outra coisa, ou o vídeo mudou, a preferência não passa por cima.
        if (ctx !== next || token !== mineAtLoad) return;
        const id = preferredOption(options, language);
        if (id) void select(id);
      });
    }
  };

  const toggle = (): void => {
    if (searchState === 'busy') {
      announce('Buscando legendas, aguarde.');
      return;
    }
    const decision = toggleDecision({ current, last: lastChoice, available: options.map((o) => o.id) });
    if (decision.kind === 'off') {
      void select(OFF);
      return;
    }
    if (decision.kind === 'select') {
      void select(decision.id);
      return;
    }
    if (canSearch(ctx) && searchState === 'idle') {
      void runSearch().then(() => {
        const next = toggleDecision({ current, last: lastChoice, available: options.map((o) => o.id) });
        if (next.kind === 'select') void select(next.id);
        else announce('Nenhuma legenda encontrada para este título.');
      });
      return;
    }
    announce(
      canSearch(ctx)
        ? 'Nenhuma legenda disponível. Abra o menu de legendas.'
        : 'Nenhuma legenda carregada. Abra o menu de legendas para escolher um arquivo.',
    );
  };

  const clear = (): void => {
    token++;
    slot.drop();
    resetState(null);
    view.close();
    paint();
  };

  const repaint = (): void => view.mount(opts.host());

  applyCaptionStyle(video(), style);
  paint();
  return { load, toggle, clear, repaint };
};
