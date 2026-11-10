/** Contagem com a forma certa do substantivo em pt-BR: "1 episódio", "2 episódios", "0 episódios". */
export const pluralize = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;
