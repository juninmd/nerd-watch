import { storage } from './playback-service.ts';

/**
 * Preferências de legenda por navegador: idioma escolhido e aparência. Valor lido do armazenamento é
 * validado; lixo ou valor de versão antiga volta ao padrão, nunca quebra o player.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CAPTION_LANG_KEY = 'nw.captions.lang';
export const CAPTION_STYLE_KEY = 'nw.captions.style';

export const CAPTION_SIZES = { sm: 0.8, md: 1, lg: 1.3, xl: 1.6 } as const;
export type CaptionSize = keyof typeof CAPTION_SIZES;

/** Fundo atrás do texto, em porcentagem de opacidade. 90% é o padrão: contraste alto mesmo sobre cena clara. */
export const CAPTION_BACKGROUNDS = [0, 50, 75, 90, 100] as const;
export type CaptionBackground = (typeof CAPTION_BACKGROUNDS)[number];

export const CAPTION_COLORS = { white: '#ffffff', yellow: '#ffe600' } as const;
export type CaptionColor = keyof typeof CAPTION_COLORS;

export interface CaptionStyle {
  size: CaptionSize;
  background: CaptionBackground;
  color: CaptionColor;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { size: 'md', background: 90, color: 'white' };

const LANGUAGE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

const hasKey = <T extends object>(table: T, value: unknown): value is keyof T =>
  typeof value === 'string' && Object.hasOwn(table, value);

/** Lê o estilo guardado. Campo inválido cai no padrão daquele campo, sem descartar os válidos. */
export const parseCaptionStyle = (raw: string | null): CaptionStyle => {
  let data: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch {
      // JSON corrompido: fica com o padrão.
    }
  }
  const background = CAPTION_BACKGROUNDS.find((b) => b === data.background) ?? DEFAULT_CAPTION_STYLE.background;
  return {
    size: hasKey(CAPTION_SIZES, data.size) ? data.size : DEFAULT_CAPTION_STYLE.size,
    background,
    color: hasKey(CAPTION_COLORS, data.color) ? data.color : DEFAULT_CAPTION_STYLE.color,
  };
};

/** Idioma guardado (ex.: `pt-BR`). Null quando ausente ou fora do formato de código de idioma. */
export const parseCaptionLanguage = (raw: string | null): string | null => (raw && LANGUAGE_RE.test(raw) ? raw : null);

export interface CaptionPrefs {
  language(): string | null;
  setLanguage(code: string): void;
  style(): CaptionStyle;
  setStyle(style: CaptionStyle): void;
}

export const createCaptionPrefs = (store: KeyValueStore): CaptionPrefs => ({
  language: () => parseCaptionLanguage(store.getItem(CAPTION_LANG_KEY)),
  setLanguage: (code) => {
    if (LANGUAGE_RE.test(code)) store.setItem(CAPTION_LANG_KEY, code);
  },
  style: () => parseCaptionStyle(store.getItem(CAPTION_STYLE_KEY)),
  setStyle: (style) => store.setItem(CAPTION_STYLE_KEY, JSON.stringify(style)),
});

/** Preferências do app. `storage` já engole erro de armazenamento bloqueado. */
export const captionPrefs = createCaptionPrefs(storage);
