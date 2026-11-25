import { Accordion, Badge, Button, Tabs } from '@juninmd/sonido';
import { ALL, messageLink, type PinInfo, type TopicTab } from './channel-topics.ts';

/** Abas por subgrupo (tópico do fórum): "Todos" mostra tudo agrupado; cada aba mostra só aquele tópico. */
export function TopicTabs({ tabs, active, total, onChange }: { tabs: readonly TopicTab[]; active: string; total: number; onChange: (id: string) => void }) {
  if (tabs.length === 0) return null;
  const items = [{ key: ALL, label: 'Todos', badge: <Badge>{total}</Badge> }, ...tabs.map((t) => ({ key: t.id, label: `${t.pinned ? '📌 ' : ''}${t.title}`, badge: <Badge>{t.count}</Badge> }))];
  return <Tabs className="tg-topics" items={items} value={active} onChange={onChange} label="Subgrupos do canal" variant="pill" />;
}

const pinLabel = (text: string | null): string => {
  const first = text?.split('\n').find((l) => l.trim());
  return first ? first.trim() : 'mensagem fixada (sem texto)';
};

/** No celular a lista de fixadas começa recolhida: não empurra os vídeos para baixo. */
const isPhone = (): boolean => typeof matchMedia === 'function' && matchMedia('(max-width: 980px)').matches;

interface PinsCardProps {
  handle: string;
  pins: readonly PinInfo[];
  tabs: readonly TopicTab[];
  onTopic: (id: string) => void;
}

/** Barra lateral de fixadas: tópicos fixados (abrem a aba) e mensagens fixadas (abrem no Telegram). */
export function PinsCard({ handle, pins, tabs, onTopic }: PinsCardProps) {
  const pinnedTopics = tabs.filter((t) => t.pinned);
  if (pins.length === 0 && pinnedTopics.length === 0) return null;
  const content = (
    <ul className="tg-pin-list">
      {pinnedTopics.map((t) => (
        <li key={`t-${t.id}`}>
          <Button variant="ghost" size="sm" onClick={() => onTopic(t.id)} iconEnd={<Badge>{t.count}</Badge>}>
            📌 {t.title}
          </Button>
        </li>
      ))}
      {pins.map((p) => (
        <li key={`m-${p.messageId}`}>
          <a className="tg-pin-link" href={messageLink(handle, p.messageId)} target="_blank" rel="noopener noreferrer">
            {pinLabel(p.text)}
            {p.postedAt && <small>{new Date(p.postedAt).toLocaleDateString('pt-BR')}</small>}
          </a>
        </li>
      ))}
    </ul>
  );
  const title = (
    <>
      Fixadas <Badge>{pins.length + pinnedTopics.length}</Badge>
    </>
  );
  return <Accordion className="side-card tg-pins" items={[{ key: 'pins', title, content }]} defaultOpen={isPhone() ? [] : ['pins']} />;
}
