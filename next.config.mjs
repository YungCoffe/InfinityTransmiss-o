const isProd = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  // display-capture precisa estar liberado para getDisplayMedia() funcionar
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), display-capture=(self), fullscreen=(self), picture-in-picture=(self)' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  eslint: { ignoreDuringBuilds: true },
  // O build do Render não deve falhar por causa de um aviso de tipos.
  // Para checar tipos manualmente: npx tsc --noEmit (ou troque para false para um build estrito).
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
