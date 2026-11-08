'use client';

import ErrorScreen from '@/components/ErrorScreen';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorScreen kind="connection" description="Algo deu errado ao carregar esta página. Tente de novo." onRetry={reset} />;
}
