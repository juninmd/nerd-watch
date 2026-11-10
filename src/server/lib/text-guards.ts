/** Caracteres de controle (U+0000 a U+001F e U+007F), exceto os permitidos. Feito por código: regex com controle é erro no lint. */
export const hasControlChar = (text: string, allowed: ReadonlySet<number> = new Set()): boolean =>
  [...text].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (code < 0x20 || code === 0x7f) && !allowed.has(code);
  });

export const TAB = 0x09;
export const LF = 0x0a;
export const CR = 0x0d;
