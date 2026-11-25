# ADR 0007 — Cliente migra para React com os componentes do Sonido

- **Status:** aceito
- **Data:** 2026-11-25

## Contexto

O cliente foi escrito em TS vanilla, com HTML montado em string e componentes locais em `src/client/ui/` e
nos CSS de `src/client/styles/`. O [Sonido](https://github.com/juninmd/sonido) (`@juninmd/sonido`) é o design
system dos apps do juninmd, já com peças desenhadas a partir do nerd-watch (NavRail, CommandPalette, botões),
mas é uma biblioteca React. Usar 100% dele exige que o cliente renderize com React.

## Decisão

1. **React + Sonido como base de UI**: `react`, `react-dom` e `@juninmd/sonido` entram como dependências;
   `tsconfig` usa `jsx: react-jsx`; `styles.css` importa `@juninmd/sonido/styles.css` antes do CSS local.
2. **Reescrita completa**: a casca (`app/shell.tsx`) virou React primeiro (PR #239) e, em seguida, todas as telas
   num só PR, apagando os componentes e o CSS locais que ficaram sem uso. Não há mais tela vanilla.
3. **Componente que falta no Sonido vai para o Sonido**, não fica como cópia local: enquanto não existir,
   a peça local é listada no PR como pendência.

## Consequências

- Bundle de entrada cresce de 119 kB para 351 kB (React) e o CSS de 104 kB para 202 kB (Sonido); total em brotli de
  157 kB para 230 kB.
- O NavRail do Sonido usa `<button>` em vez de `<a href>`: clique do meio e "abrir em nova aba" no menu deixam
  de existir até o Sonido aceitar `href` nos itens.

## Pendências no Sonido

Peças que ficaram locais por falta de equivalente (ou de opção) no Sonido:

- `PageHeader`/`EmptyState` sem nível de título configurável: `ui/page-header.tsx` e as telas de erro põem um
  `<h1>` oculto para foco e leitor de tela.
- `Button` sem `href`: links com cara de botão usam as classes `sn-button` num `<a>`.
- `NavRail` sem `href` nos itens; `Carousel` e `FilterChips` só aceitam rótulo em texto (sem ícone);
  `Select` sem opção desabilitada; `Accordion` sem `onToggle` (histórico usa `<details>`).
- `CommandPalette` sem callback da busca: `app/palette-dialog.tsx` pré-filtra com `palette-search.ts`.
- `Artwork` sem `referrerPolicy`: logos de addon usam `<img>` simples.
- Sem equivalente: hero recolhível do título (`catalog/title-hero.tsx`), faixa de 7 dias da agenda, colunas
  empilhadas e barra segmentada das estatísticas (`stats/stat-marks.tsx`), fila e overlays do player.
