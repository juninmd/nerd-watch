import type { CaptionStyle } from './player-captions-prefs.ts';
import type { CaptionContext } from './player-captions-model.ts';

/** Contrato entre o controlador de legendas (player-captions.ts) e o menu (player-captions-view.tsx). */

interface CaptionsOption {
  id: string;
  label: string;
  detail: string;
}

/** O que o menu de legendas desenha (player-captions-view.tsx). Não decide nada: só lê. */
export interface CaptionsViewModel {
  current: string;
  currentLabel: string;
  options: CaptionsOption[];
  canSearch: boolean;
  searchBusy: boolean;
  message: string;
  offsetMs: number;
  style: CaptionStyle;
}

export interface CaptionsActions {
  select(id: string): void;
  search(): void;
  pickFile(file: File): void;
  offset(deltaMs: number | 'reset'): void;
  style(next: CaptionStyle): void;
}

export interface Captions {
  /** Novo vídeo: esquece a escolha anterior e, se há preferência de idioma, busca e liga essa legenda. */
  load(ctx: CaptionContext | null): void;
  /** Tecla "c". */
  toggle(): void;
  clear(): void;
  view(): CaptionsViewModel;
  /** Último aviso para leitor de tela; `seq` muda a cada aviso, mesmo com texto repetido. */
  announcement(): { text: string; seq: number };
  isOpen(): boolean;
  setOpen(open: boolean): void;
  actions: CaptionsActions;
}
