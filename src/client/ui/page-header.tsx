/**
 * `PageHeader` do Sonido com o `<h1>` da tela: o do Sonido desenha o título como `<h2>`, e a casca leva o foco e o
 * leitor de tela ao `<h1>` a cada troca de rota. Sai quando o Sonido aceitar o nível do título.
 */
import { PageHeader as SonidoPageHeader } from '@juninmd/sonido';
import type { ComponentProps } from 'react';

export function PageHeader(props: ComponentProps<typeof SonidoPageHeader>) {
  return (
    <>
      <h1 className="sr-only">{props.title}</h1>
      <SonidoPageHeader {...props} />
    </>
  );
}
