declare module 'plyr' {
  export interface PlyrOptions {
    controls?: string[];
    autoplay?: boolean;
  }

  export default class Plyr {
    constructor(target: HTMLElement, options?: PlyrOptions);
    elements: { container: HTMLElement };
    destroy(): void;
  }
}
