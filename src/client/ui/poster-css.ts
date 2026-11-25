/** Valor de `background-image` seguro para URL com aspas ou barra invertida (vem de catálogos de terceiros). */
export const posterCssUrl = (url: string): string => `url("${url.replace(/["\\]/g, '\\$&')}")`;
