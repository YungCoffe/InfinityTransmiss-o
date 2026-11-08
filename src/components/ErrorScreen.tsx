import Link from 'next/link';
import { Icon } from './Icon';

export type ErrorKind =
  | 'not-found'
  | 'closed'
  | 'full'
  | 'permission'
  | 'unsupported'
  | 'offline'
  | 'connection'
  | 'replaced'
  | 'rate-limited'
  | 'capture'
  | 'busy';

const COPY: Record<ErrorKind, { title: string; text: string }> = {
  'not-found': { title: 'Sala não encontrada', text: 'Confira o código de 6 caracteres ou peça um novo link ao apresentador.' },
  closed: { title: 'Sala encerrada', text: 'O apresentador encerrou esta sala ou ela expirou por inatividade. Crie uma nova sala para transmitir de novo.' },
  full: { title: 'Sala cheia', text: 'Esta sala atingiu o limite de espectadores. Tente de novo em alguns instantes ou peça ao apresentador para liberar uma vaga.' },
  permission: {
    title: 'Permissão negada',
    text: 'A captura de tela não foi autorizada. Clique em “Compartilhar tela” e escolha uma tela, janela ou aba. Se o navegador bloqueou o recurso, libere-o nas configurações do site.',
  },
  unsupported: {
    title: 'Navegador não suportado',
    text: 'Este navegador não oferece o recurso necessário. Use uma versão atual do Chrome, Edge, Firefox ou Safari. Para transmitir, use um computador.',
  },
  offline: { title: 'Servidor offline', text: 'Não conseguimos falar com o servidor agora. Verifique sua internet e tente de novo em alguns segundos.' },
  connection: { title: 'Erro de conexão', text: 'A conexão com a sala falhou. Tente de novo; se persistir, recarregue a página.' },
  replaced: { title: 'Sala aberta em outra aba', text: 'Você entrou nesta sala em outra aba ou janela. Use a aba mais recente ou entre de novo aqui.' },
  'rate-limited': { title: 'Muitas tentativas', text: 'Você fez muitas tentativas em pouco tempo. Aguarde cerca de um minuto e tente de novo.' },
  capture: { title: 'Não foi possível capturar a tela', text: 'O navegador não conseguiu iniciar a captura. Tente escolher outra fonte ou recarregue a página.' },
  busy: { title: 'Servidor ocupado', text: 'O servidor atingiu o limite de salas ativas. Tente criar a sala de novo em alguns minutos.' },
};

interface Props {
  kind: ErrorKind;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  hideHome?: boolean;
}

export default function ErrorScreen({ kind, description, onRetry, retryLabel = 'Tentar de novo', compact = false, hideHome = false }: Props) {
  const c = COPY[kind];
  const card = (
    <div role="alert" className="card w-full max-w-md p-6 text-center text-black">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-ink bg-brand-600 text-white">
        <Icon name="alert" size={24} />
      </span>
      <h2 className="mt-4 text-xl font-black">{c.title}</h2>
      <p className="mt-2 text-sm font-medium leading-relaxed text-zinc-700">{description ?? c.text}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            {retryLabel}
          </button>
        )}
        {!hideHome && (
          <Link href="/" className="btn">
            Voltar ao início
          </Link>
        )}
      </div>
    </div>
  );
  if (compact) return <div className="grid place-items-center p-4">{card}</div>;
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-md">{card}</div>
    </main>
  );
}
