import type { CredentialDto, CredentialGroupId } from '../api/credentials.ts';

export interface CredentialSection {
  id: CredentialGroupId;
  label: string;
  fields: CredentialDto[];
}

/** Agrupa na ordem em que os grupos aparecem na resposta; grupo sem campo não vira seção. */
export const groupCredentials = (fields: readonly CredentialDto[], labels: Record<CredentialGroupId, string>): CredentialSection[] => {
  const sections: CredentialSection[] = [];
  for (const field of fields) {
    let section = sections.find((s) => s.id === field.group);
    if (!section) {
      section = { id: field.group, label: labels[field.group], fields: [] };
      sections.push(section);
    }
    section.fields.push(field);
  }
  return sections;
};

/** Estado de um campo em texto: segredo mostra só a pista mascarada, nunca o valor. */
export const credentialStatus = (field: Pick<CredentialDto, 'configured' | 'secret' | 'hint' | 'value'>): string => {
  if (!field.configured) return 'não configurada';
  return field.secret ? `configurada ${field.hint ?? ''}`.trim() : 'configurada';
};
