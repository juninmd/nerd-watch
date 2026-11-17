import { describe, expect, test } from "bun:test";
import { isNavActive, NAV_GROUPS, NAV_ITEMS, readNavCompact, writeNavCompact } from "../../src/client/app/nav-model.ts";

const item = (path: string) => {
  const found = NAV_ITEMS.find((i) => i.path === path);
  if (!found) throw new Error(`sem item ${path}`);
  return found;
};

describe("nav-model", () => {
  test("todo caminho do menu é único e todo grupo tem itens", () => {
    const paths = NAV_ITEMS.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const g of NAV_GROUPS) expect(g.items.length).toBeGreaterThan(0);
  });

  test("o início só vale na raiz", () => {
    expect(isNavActive(item("/"), "/")).toBe(true);
    expect(isNavActive(item("/"), "/library")).toBe(false);
  });

  test("telas filhas ativam o item da família", () => {
    expect(isNavActive(item("/library"), "/title/tmdb/tv/123")).toBe(true);
    expect(isNavActive(item("/telegram"), "/watch/abc")).toBe(true);
    expect(isNavActive(item("/lists"), "/lists/minha-lista")).toBe(true);
  });

  test("listas e biblioteca não se confundem", () => {
    expect(isNavActive(item("/library"), "/lists")).toBe(false);
    expect(isNavActive(item("/lists"), "/library")).toBe(false);
  });

  test("a barra do celular tem 4 ou 5 atalhos", () => {
    const n = NAV_ITEMS.filter((i) => i.primary).length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(5);
  });

  test("preferência de menu compacto sobrevive e tolera storage quebrado", () => {
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
    };
    expect(readNavCompact(storage)).toBe(false);
    writeNavCompact(true, storage);
    expect(readNavCompact(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(readNavCompact(broken)).toBe(false);
    expect(() => writeNavCompact(true, broken)).not.toThrow();
  });
});
