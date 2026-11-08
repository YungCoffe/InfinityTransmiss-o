import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'infinityTransmissão',
    short_name: 'infinity',
    description: 'Assista telas com amigos em tempo real.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'pt-BR',
    background_color: '#ffffff',
    theme_color: '#C8102E',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
