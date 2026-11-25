import { Button, EmptyState, Skeleton } from '@juninmd/sonido';
import { navigate } from '../app/router.ts';
import { Icon } from '../ui/icon.tsx';

/**
 * Erro ao carregar um título ou pessoa: a tela não fica sem saída. "Voltar" usa o histórico
 * (ou vai para o Início se a aba começou aqui) e "tentar de novo" refaz a requisição.
 * A mensagem é fixa: o texto do servidor (ex.: "parâmetros inválidos") não é para o usuário.
 */
export function TitleError({ onRetry }: { onRetry: () => void }) {
  const back = () => {
    if (history.length > 1) history.back();
    else navigate('/');
  };
  return (
    <div role="alert">
      <h1 className="sr-only">não foi possível carregar este título</h1>
      <EmptyState
        icon={<Icon name="alert" />}
        title="não foi possível carregar este título"
        action={
          <>
            <Button variant="ghost" size="sm" onClick={back}>
              voltar
            </Button>
            <Button size="sm" onClick={onRetry}>
              tentar de novo
            </Button>
          </>
        }
      />
    </div>
  );
}

/** Esqueleto da ficha enquanto a primeira resposta não chega. */
export function TitleSkeleton() {
  return <Skeleton media rows={5} label="Carregando título…" />;
}
