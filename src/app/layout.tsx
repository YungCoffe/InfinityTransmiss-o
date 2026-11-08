import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'infinityTransmissão: assista telas com amigos em tempo real', template: '%s | infinityTransmissão' },
  description: 'Compartilhe a tela e assista junto com os amigos, em alta resolução e baixa latência. Sem anúncios, sem rastreamento e sem gravação.',
  applicationName: 'infinityTransmissão',
};

export const viewport: Viewport = {
  themeColor: '#C8102E',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
