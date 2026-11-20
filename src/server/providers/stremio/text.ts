/**
 * Texto que vem de addon: entidades HTML e caracteres de controle.
 *
 * Addons publicam títulos com entidade **sem decodificar** (o Torrentio devolve `Can&#039;t`), e a
 * interface escapa de novo na hora de montar o HTML. Sem decodificar antes, o usuário lê `Can&#039;t`
 * literal na tela. Aqui só entram entidades conhecidas e numéricas válidas: o que não reconhecemos
 * fica como veio, porque adivinhar em texto de terceiro é pior do que mostrar o cru.
 */

const NAMED: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

/** Entidade `&nome;`, `&#39;` ou `&#x27;`. */
const ENTITY = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g;

/**
 * Número da entidade: fora do Unicode (ou metade de par surrogate) fica como veio; caractere de
 * controle some, porque ele iria para HTML e para nome de arquivo.
 */
const fromCodePoint = (code: number, match: string): string => {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
  if (code >= 0xd800 && code <= 0xdfff) return match;
  if (code < 0x20 || code === 0x7f) return '';
  return String.fromCodePoint(code);
};

export const decodeEntities = (raw: string): string =>
  raw.replace(ENTITY, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return fromCodePoint(Number.parseInt(body.slice(2), 16), match);
    if (body.startsWith('#')) return fromCodePoint(Number.parseInt(body.slice(1), 10), match);
    return NAMED[body.toLowerCase()] ?? match;
  });
