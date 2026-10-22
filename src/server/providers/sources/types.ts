import type { NewTelegramItem } from '../../repo/telegram.ts';
import type { TelegramChannelMode } from '../../types.ts';

export type SourceMode = Exclude<TelegramChannelMode, 'public' | 'personal' | 'bot'>;

/** Erro de domínio com o status HTTP que a rota devolve; a mensagem é nossa (nunca o corpo cru do serviço remoto). */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 | 429 | 501 | 502 = 502,
  ) {
    super(message);
  }
}

export interface PlayContext {
  handle: string;
  fileRef: string;
  range: string | undefined;
}

/**
 * Uma fonte de vídeos que vira "canal": a pasta/biblioteca é o canal e cada vídeo um item. O `handle` identifica o
 * canal no banco e precisa ser único entre TODAS as fontes (prefixe quando o valor puro puder colidir).
 */
export interface FileSource {
  mode: SourceMode;
  /** Link externo para abrir a origem no navegador; null quando não existe um. */
  link(handle: string): string | null;
  /** Valida o que o usuário digitou e devolve o handle estável e o nome do canal. Lança `SourceError`. */
  resolve(input: string): Promise<{ handle: string; name: string }>;
  /** Vídeos do canal, mais novos primeiro (teto razoável). `messageId` numérico crescente com o tempo. */
  list(handle: string): Promise<NewTelegramItem[]>;
  /** Resposta de reprodução: proxy com Range, redirect ou erro JSON. `fileRef` vem do banco, mas valide mesmo assim. */
  play(ctx: PlayContext): Promise<Response>;
  /** Bytes da miniatura (jpeg/png) para o item, ou null. Chamado só para itens sem miniatura local. */
  thumb?(item: { handle: string; fileRef: string | null; thumbnailUrl: string | null }): Promise<Uint8Array | null>;
  /** Reprodução por iframe quando o serviço não permite proxy (ex.: YouTube). Sem isso o item usa o player do app. */
  embedUrl?(fileRef: string): string | null;
}

export interface SettingField {
  key: string;
  label: string;
  /** Variável de ambiente (e do `.env`) onde o valor fica. */
  env: string;
  /** Segredos nunca voltam para o navegador, só `set: true`. */
  secret?: boolean;
  placeholder?: string;
  required?: boolean;
  /** Só o `.env` altera (a UI mostra e não grava): para valores que ampliam o acesso, como as pastas liberadas do disco. */
  readOnly?: boolean;
  /** Mensagem de erro, ou null quando o valor é válido. Valores vazios limpam o campo e não passam por aqui. */
  validate?(value: string): string | null;
}

export interface SourceDescriptor {
  id: string;
  title: string;
  description: string;
  /** Nome de ícone do cliente (`icons.ts`). */
  icon: string;
  fields: SettingField[];
  /** Passo a passo do cadastro no serviço. HTML estático nosso; `{{redirectUri}}` vira a URL de retorno do OAuth. */
  guide?: { summary: string; steps: string[] };
  /** A tela de Conexões já tem um cartão dedicado (Drive): o cartão genérico não é desenhado. */
  ownCard?: boolean;
  /** Presente quando a fonte autentica por OAuth (botão "Conectar"). */
  oauth?: import('../oauth/client.ts').OAuthClient;
  /** Presente quando a fonte cria canais (modo de arquivo). */
  add?: { mode: SourceMode; label: string; placeholder: string; hint?: string };
  /** Host do redirect do OAuth; alguns serviços só aceitam `localhost`. */
  redirectHost?: 'localhost' | '127.0.0.1';
  configured(): boolean;
  connected(): boolean;
  /** Depois de salvar campos (ex.: trocar o client ID invalida o token guardado). */
  onSettingsChanged?(changedKeys: string[]): Promise<void> | void;
}
