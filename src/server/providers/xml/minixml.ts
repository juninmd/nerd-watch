/**
 * Leitor XML mínimo para respostas de WebDAV e S3 (sem dependência nova). Ignora o prefixo de namespace (`d:`, `D:`,
 * nenhum) e compara nomes em minúsculas. Recusa DTD/ENTITY (ataque de entidades) e tem teto de profundidade e de nós.
 */
export interface XmlNode {
  /** Nome local, minúsculo, sem prefixo. */
  name: string;
  /** Texto direto do nó (sem os filhos), com entidades decodificadas. */
  text: string;
  children: XmlNode[];
}

export class XmlError extends Error {}

const MAX_DEPTH = 40;
const MAX_NODES = 50_000;
const NAME_RE = /^[A-Za-z_][\w.:-]*$/;
const ENTITY = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export const decodeEntities = (text: string): string =>
  text.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body] ?? whole;
    const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : whole;
  });

const localName = (raw: string): string => raw.slice(raw.indexOf(':') + 1).toLowerCase();

/** Posição do `>` que fecha a tag iniciada em `from`, ignorando `>` dentro de aspas nos atributos. */
const tagEnd = (xml: string, from: number): number => {
  let quote = '';
  for (let i = from; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
};

const endOf = (xml: string, token: string, from: number): number => {
  const at = xml.indexOf(token, from);
  if (at === -1) throw new XmlError('XML malformado');
  return at + token.length;
};

export const parseXml = (xml: string): XmlNode => {
  const doc: XmlNode = { name: '#document', text: '', children: [] };
  const stack: XmlNode[] = [doc];
  let nodes = 0;
  let pos = 0;

  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    const textEnd = lt === -1 ? xml.length : lt;
    if (textEnd > pos) (stack.at(-1) as XmlNode).text += decodeEntities(xml.slice(pos, textEnd));
    if (lt === -1) break;

    if (xml.startsWith('<!--', lt)) {
      pos = endOf(xml, '-->', lt + 4);
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlError('XML malformado');
      (stack.at(-1) as XmlNode).text += xml.slice(lt + 9, end);
      pos = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      pos = endOf(xml, '?>', lt + 2);
    } else if (xml.startsWith('<!', lt)) {
      throw new XmlError('DOCTYPE e declarações de entidade não são aceitos');
    } else if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt);
      if (end === -1) throw new XmlError('XML malformado');
      const name = localName(xml.slice(lt + 2, end).trim());
      const at = stack.findLastIndex((n) => n.name === name);
      if (at <= 0) throw new XmlError('tag de fechamento sem abertura');
      stack.length = at;
      pos = end + 1;
    } else {
      const end = tagEnd(xml, lt + 1);
      if (end === -1) throw new XmlError('XML malformado');
      const inner = xml.slice(lt + 1, end);
      const selfClosing = inner.endsWith('/');
      const rawName = (selfClosing ? inner.slice(0, -1) : inner).trim().split(/[\s/]/)[0] ?? '';
      if (!NAME_RE.test(rawName)) throw new XmlError('nome de tag inválido');
      const node: XmlNode = { name: localName(rawName), text: '', children: [] };
      if (++nodes > MAX_NODES) throw new XmlError('XML grande demais');
      (stack.at(-1) as XmlNode).children.push(node);
      if (!selfClosing) {
        stack.push(node);
        if (stack.length > MAX_DEPTH) throw new XmlError('XML fundo demais');
      }
      pos = end + 1;
    }
  }

  if (stack.length !== 1) throw new XmlError('XML sem fechamento');
  const root = doc.children[0];
  if (!root) throw new XmlError('XML vazio');
  return root;
};

export const childrenNamed = (node: XmlNode, name: string): XmlNode[] => node.children.filter((c) => c.name === name.toLowerCase());

export const childText = (node: XmlNode, name: string): string | undefined => childrenNamed(node, name)[0]?.text.trim();

/** Todos os descendentes com esse nome, em ordem de documento (a árvore já tem teto de nós). */
export const findAll = (root: XmlNode, name: string): XmlNode[] => {
  const want = name.toLowerCase();
  const out: XmlNode[] = [];
  const pending: XmlNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop() as XmlNode;
    if (node !== root && node.name === want) out.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i] as XmlNode);
  }
  return out;
};
