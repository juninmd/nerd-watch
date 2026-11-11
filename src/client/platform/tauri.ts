import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Ponte do app desktop (Tauri) — o cliente é o mesmo do navegador, só muda de onde vêm os bytes.
 *
 * - `/api/*` do mesmo origin vira IPC (`api_request`), porque a janela abre em `tauri://localhost`
 *   e não existe servidor de página.
 * - `src`/`poster` de imagem, vídeo e `<source>` com `/api/...` aponta para o loopback interno do
 *   worker: `<video>` e `Range` não passam por IPC.
 * - Link externo (trailer, streaming, OAuth) abre no navegador do sistema.
 *
 * Fora do Tauri nada disto é ativado: dev, Docker e os testes seguem com `fetch` normal.
 */

declare global {
  interface Window {
    __NERD_WATCH_MEDIA_BASE__?: string;
    __NERD_WATCH_TAURI__?: boolean;
  }
}

const desktops = (): boolean => isTauri();

/** No desktop, o loopback do worker; no navegador, string vazia (URL relativa normal). */
export const mediaBase = (): string => window.__NERD_WATCH_MEDIA_BASE__ ?? '';

/** Reescreve caminho `/api/...` para o loopback do worker, mantendo query. */
export const mediaUrl = (value: string): string => {
  const base = mediaBase();
  if (!base || !value.includes('/api/')) return value;
  try {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return value;
    return `${base}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
};

const fromBase64 = (raw: string): Uint8Array => {
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** `Blob` exige `ArrayBuffer` "puro"; o buffer do `Uint8Array` é `ArrayBufferLike` nas tipos do TS. */
const asBody = (bytes: Uint8Array): Blob => new Blob([bytes as unknown as BlobPart]);

interface ApiReply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const apiPath = (input: RequestInfo | URL): string | null => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
};

/** Troca o `fetch` de `/api/*` por IPC. Idempotente. */
export const installApiBridge = (): void => {
  if (!desktops() || window.__NERD_WATCH_TAURI__) return;
  window.__NERD_WATCH_TAURI__ = true;
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = apiPath(input);
    if (!path) return original(input, init);

    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      // Origin/Host do webview não valem do lado do processo; o servidor recusaria a origem.
      if (key === 'origin' || key === 'referer' || key === 'host') return;
      headers[key] = value;
    });
    const buffer = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
    const reply = await invoke<ApiReply>('api_request', {
      method: request.method,
      path,
      headers,
      body: buffer && buffer.byteLength > 0 ? toBase64(new Uint8Array(buffer)) : null,
    });
    const body = reply.status === 204 || reply.status === 304 ? null : asBody(fromBase64(reply.body));
    return new Response(body, { status: reply.status, headers: reply.headers });
  }) as typeof fetch;
};

/** `<img>`, `<video>`, `<source>` e `poster` passam a apontar para o loopback do worker. */
export const installMediaUrls = (): void => {
  if (!desktops() || !mediaBase()) return;
  const patchAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string): void {
    if ((name === 'src' || name === 'poster') && typeof value === 'string' && value.includes('/api/')) {
      patchAttribute.call(this, name, mediaUrl(value));
      return;
    }
    patchAttribute.call(this, name, value);
  };

  const patchProperty = (proto: object, property: 'src'): void => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor?.set || !descriptor.get) return;
    Object.defineProperty(proto, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(this: HTMLElement, value: string) {
        descriptor.set?.call(this, typeof value === 'string' ? mediaUrl(value) : value);
      },
    });
  };
  patchProperty(HTMLMediaElement.prototype, 'src');
  patchProperty(HTMLImageElement.prototype, 'src');
};

/** Link http(s) fora do app abre no navegador; `window.open` (OAuth, download) idem. */
export const installExternalLinks = (): void => {
  if (!desktops()) return;
  const open = (url: string): void => {
    void invoke('open_external', { url }).catch(() => undefined);
  };

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) return;
      if (new URL(href).origin === location.origin) return;
      event.preventDefault();
      open(href);
    },
    true,
  );

  window.open = ((url?: string | URL) => {
    if (url) open(String(url));
    return null;
  }) as typeof window.open;
};

/** Liga as três pontes. Chamar antes de montar a tela. */
export const installDesktopBridge = (): void => {
  if (!desktops()) return;
  installApiBridge();
  installMediaUrls();
  installExternalLinks();
};
