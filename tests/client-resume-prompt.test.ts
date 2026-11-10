import { describe, expect, test } from 'bun:test';
import { formatResumeTime, PROMPT_MIN_SECONDS, resumePromptFor, resumePromptLabels } from '../src/client/resume-prompt.ts';

/** A pergunta só aparece quando perguntar ajuda: posição real, não terminada, não um começo qualquer. */
describe('resumePromptFor', () => {
  const pos = (seconds: number, duration: number | null = 3600) => ({ seconds, duration, at: 0 });

  test('sem posição salva não há pergunta', () => {
    expect(resumePromptFor(undefined)).toBeNull();
  });

  test('pouco assistido retoma sem perguntar', () => {
    expect(resumePromptFor(pos(PROMPT_MIN_SECONDS - 1))).toBeNull();
  });

  test('posição no meio do vídeo pergunta, com o segundo inteiro', () => {
    expect(resumePromptFor(pos(754.9))).toEqual({ seconds: 754 });
  });

  test('vídeo já terminado não pergunta', () => {
    expect(resumePromptFor(pos(3500, 3600))).toBeNull();
  });

  test('sem duração conhecida, a pergunta vale pelos segundos', () => {
    expect(resumePromptFor(pos(300, null))).toEqual({ seconds: 300 });
  });
});

describe('texto da pergunta', () => {
  test('formato curto de mm:ss e h:mm:ss', () => {
    expect(formatResumeTime(245)).toBe('4:05');
    expect(formatResumeTime(3725)).toBe('1:02:05');
    expect(formatResumeTime(-3)).toBe('0:00');
  });

  test('botões dizem o ponto e a alternativa', () => {
    expect(resumePromptLabels(245)).toEqual({ resume: 'Retomar de 4:05', start: 'Começar do início' });
  });
});
