export const dynamic = 'force-dynamic';

// O server.js responde a este caminho antes do Next.js; esta rota cobre o caso de rodar só com "next dev".
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
