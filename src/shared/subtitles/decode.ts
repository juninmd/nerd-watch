/**
 * Bytes de legenda para texto. Arquivos de pt-BR antigos vêm quase sempre em Windows-1252 (ou Latin-1),
 * e o UTF-8 com `fatal` recusa sequência inválida em vez de trocar letra por "�".
 */

/** Windows-1252 aceita qualquer byte, então é o último recurso e nunca falha. */
const LEGACY_FALLBACK = 'windows-1252';

/** BOM de UTF-16 (FF FE, little endian; FE FF, big endian). O próprio TextDecoder consome o BOM. */
const utf16Label = (bytes: Uint8Array): string | null => {
  if (bytes.length < 2) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
};

export const decodeSubtitleBytes = (bytes: Uint8Array): string => {
  const utf16 = utf16Label(bytes);
  if (utf16) return new TextDecoder(utf16).decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(LEGACY_FALLBACK).decode(bytes);
  }
};
