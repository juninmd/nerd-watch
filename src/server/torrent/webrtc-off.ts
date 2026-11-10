/**
 * Stub do `node-datachannel` usado só no binário desktop (`scripts/build-server.ts`).
 *
 * O módulo nativo `.node` não entra em um executável único do `bun build --compile`, e o
 * `webrtc-polyfill` (puxado pelo webtorrent) o importa no topo do módulo — sem o stub, o
 * servidor não sobe. As classes abaixo falham apenas quando alguém tenta abrir um peer
 * WebRTC; TCP/UDP, trackers HTTP e web seeds seguem normais, que é o caminho do acervo
 * público e da fonte Torrent. Contexto em docs/adr/0005-desktop-sidecar.md.
 */
const unavailable = (): never => {
  throw new Error('WebRTC não está disponível no app desktop; use o modo web/docker para peers WebRTC');
};

export class PeerConnection {
  constructor() {
    unavailable();
  }
}

export class RtcpReceivingSession {
  constructor() {
    unavailable();
  }
}

export class Video {
  constructor() {
    unavailable();
  }
}

export class Audio {
  constructor() {
    unavailable();
  }
}

export const cleanup = (): void => {};
