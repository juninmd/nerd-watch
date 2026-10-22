import { describe, expect, test } from 'bun:test';
import { XmlError, childText, decodeEntities, findAll, parseXml } from '../src/server/providers/xml/minixml.ts';

describe('parseXml: prefixo de namespace não importa', () => {
  test('d:, D: e sem prefixo dão o mesmo resultado', () => {
    for (const doc of [
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/a</d:href></d:response></d:multistatus>',
      '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a</D:href></D:response></D:multistatus>',
      '<multistatus xmlns="DAV:"><response><href>/a</href></response></multistatus>',
    ]) {
      const root = parseXml(doc);
      expect(findAll(root, 'response').map((r) => childText(r, 'href'))).toEqual(['/a']);
    }
  });

  test('o nome de tag é comparado em minúsculas (servidores variam)', () => {
    const root = parseXml('<D:Response><D:HREF>/x</D:HREF></D:Response>');
    expect(childText(root, 'href')).toBe('/x');
  });
});

describe('parseXml: entidades e CDATA', () => {
  test('decodifica entidades nomeadas e numéricas (decimal e hex), inclusive em nomes com acento', () => {
    const root = parseXml('<k>Ep &amp; 01 &lt;3 &#233;&#xE9; &quot;x&quot; &apos;y&apos;</k>');
    expect(root.text).toBe(`Ep & 01 <3 éé "x" 'y'`);
  });

  test('entidade inválida (surrogate, zero, acima de U+10FFFF) fica como texto, sem quebrar', () => {
    expect(decodeEntities('&#xD800; &#0; &#x110000; &bogus;')).toBe('&#xD800; &#0; &#x110000; &bogus;');
  });

  test('CDATA entra literal', () => {
    expect(parseXml('<k><![CDATA[a < b & c]]></k>').text).toBe('a < b & c');
  });

  test('href com %20 e > dentro de atributo não confundem o leitor de tags', () => {
    const root = parseXml('<r a="x>y"><href>/Ep%2001.mp4</href></r>');
    expect(childText(root, 'href')).toBe('/Ep%2001.mp4');
  });
});

describe('parseXml: entrada hostil e malformada', () => {
  test('recusa DOCTYPE e declarações de entidade (billion laughs / XXE)', () => {
    expect(() => parseXml('<!DOCTYPE r [<!ENTITY x "y">]><r>&x;</r>')).toThrow(XmlError);
    expect(() => parseXml('<!ENTITY x "y"><r/>')).toThrow(XmlError);
  });

  test('tags sem fechamento, fechamento sem abertura e XML vazio são erro, não loop', () => {
    expect(() => parseXml('<a><b></a>')).not.toThrow(); // tolerante: fecha até a abertura
    expect(() => parseXml('<a>')).toThrow(XmlError);
    expect(() => parseXml('</a>')).toThrow(XmlError);
    expect(() => parseXml('   ')).toThrow(XmlError);
    expect(() => parseXml('<a attr="sem fim>')).toThrow(XmlError);
    expect(() => parseXml('<!-- nunca fecha')).toThrow(XmlError);
  });

  test('nome de tag inválido é recusado', () => {
    expect(() => parseXml('<1abc/>')).toThrow(XmlError);
    expect(() => parseXml('<-x/>')).toThrow(XmlError);
  });

  test('profundidade absurda é recusada antes de estourar a pilha', () => {
    const deep = `${'<n>'.repeat(200)}${'</n>'.repeat(200)}`;
    expect(() => parseXml(deep)).toThrow(XmlError);
  });

  test('número de nós absurdo é recusado (teto de 50 mil)', () => {
    const wide = `<r>${'<i/>'.repeat(60_000)}</r>`;
    expect(() => parseXml(wide)).toThrow(XmlError);
  });

  test('entrada grande mas legítima passa (1 mil itens)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => `<response><href>/f${i}.mp4</href></response>`).join('');
    expect(findAll(parseXml(`<multistatus>${items}</multistatus>`), 'response')).toHaveLength(1000);
  });
});
