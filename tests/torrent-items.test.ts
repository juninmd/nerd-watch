import { describe, expect, test } from 'bun:test';
import { LIST_LIMIT, isSampleFile, selectVideoFiles, toItems } from '../src/server/providers/torrent/items.ts';

/** Lista de itens é o que o usuário assiste em ordem: a ordem natural e os ids estáveis são o contrato. */

const file = (index: number, path: string) => ({ index, path, length: 1000 });

describe('toItems — ordem natural e ids', () => {
  test('ordena "Ep 2" antes de "Ep 10" e numera o primeiro episódio como o menor id', () => {
    const items = toItems(
      [file(0, 'Serie/Ep 10.mp4'), file(1, 'Serie/Ep 2.mp4'), file(2, 'Serie/Ep 1.mp4')],
      '2026-01-01T00:00:00.000Z',
    );
    expect(items.map((i) => i.caption)).toEqual(['Ep 1', 'Ep 2', 'Ep 10']);
    expect(items.map((i) => i.messageId)).toEqual(['1', '2', '3']);
    expect(items.map((i) => i.fileRef)).toEqual(['2', '1', '0']);
  });

  test('messageId cresce com a ordem mesmo quando a comparação textual daria o contrário', () => {
    const items = toItems([file(0, 'x 9.mp4'), file(1, 'x 10.mp4')], 'agora');
    // Como texto, "10" < "9"; o contrato é a ordem natural, então o 9 vem primeiro e o id é 1.
    expect(items.map((i) => [i.caption, Number(i.messageId)])).toEqual([
      ['x 9', 1],
      ['x 10', 2],
    ]);
  });

  test('postedAt é o momento da importação, igual para todos os itens do torrent', () => {
    const items = toItems([file(0, 'a.mp4'), file(1, 'b.mp4')], '2026-03-04T05:06:07.000Z');
    expect(new Set(items.map((i) => i.postedAt))).toEqual(new Set(['2026-03-04T05:06:07.000Z']));
  });

  test('ids são estáveis entre sincronizações: a mesma lista de caminhos dá os mesmos ids', () => {
    const files = [file(0, 'b.mp4'), file(1, 'a.mp4')];
    const first = toItems(files, 'um').map((i) => `${i.messageId}:${i.caption}`);
    const second = toItems(files, 'dois').map((i) => `${i.messageId}:${i.caption}`);
    expect(second).toEqual(first);
  });
});

describe('selectVideoFiles — o que entra na lista', () => {
  test('só extensões de vídeo; .nfo, .srt, .jpg e .txt ficam de fora', () => {
    const picked = selectVideoFiles([
      file(0, 'a.nfo'),
      file(1, 'a.srt'),
      file(2, 'capa.jpg'),
      file(3, 'leia.txt'),
      file(4, 'filme.mkv'),
      file(5, 'filme.MP4'),
    ]);
    expect(picked.map((f) => f.path)).toEqual(['filme.mkv', 'filme.MP4']);
  });

  test('amostras saem: pasta Sample e a palavra sample no nome', () => {
    expect(isSampleFile('Filme/Sample/x.mp4')).toBe(true);
    expect(isSampleFile('Filme.sample.mkv')).toBe(true);
    expect(isSampleFile('Filme-sample.mp4')).toBe(true);
    expect(isSampleFile('Filme/Ep 1.mp4')).toBe(false);
    // Substring não basta: "example" contém "ample", mas não é a palavra "sample".
    expect(isSampleFile('Filme/example.mp4')).toBe(false);
    expect(selectVideoFiles([file(0, 'Filme.sample.mp4'), file(1, 'Filme.mp4')]).map((f) => f.index)).toEqual([1]);
  });

  test('teto de 500 itens, depois da ordenação', () => {
    const many = Array.from({ length: 600 }, (_, i) => file(i, `ep ${String(i).padStart(3, '0')}.mp4`));
    const items = toItems(many, 'agora');
    expect(items).toHaveLength(LIST_LIMIT);
    expect(items[0]?.caption).toBe('ep 000');
    expect(items.at(-1)?.caption).toBe('ep 499');
  });
});

describe('toItems — títulos a partir do caminho', () => {
  test('usa só o último segmento, inclusive quando o caminho usa barra invertida', () => {
    const [item] = toItems([file(0, 'Serie\\Temporada 1\\Ep 01 - Piloto.mp4')], 'agora');
    expect(item?.caption).toBe('Ep 01 - Piloto');
  });

  test('tira a extensão do título e mantém o nome quando a extensão não existe', () => {
    expect(toItems([file(0, 'Filme.v2.mkv')], 'agora')[0]?.caption).toBe('Filme.v2');
  });

  test('nome muito longo é cortado (vai para a interface e para o banco)', () => {
    const [item] = toItems([file(0, `${'x'.repeat(500)}.mp4`)], 'agora');
    expect(item?.caption?.length).toBe(200);
  });
});
