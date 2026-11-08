import ErrorScreen from '@/components/ErrorScreen';

export default function NotFound() {
  return <ErrorScreen kind="not-found" description="Esta página não existe. Volte ao início para criar uma sala ou entrar em uma." />;
}
