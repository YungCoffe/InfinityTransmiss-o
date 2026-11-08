'use strict';

/**
 * infinityTransmissão — servidor único: Next.js + Socket.IO no mesmo processo e na mesma porta.
 *   desenvolvimento: node server.js --dev     (npm run dev)
 *   produção:        node server.js           (Render: Start Command = node server.js)
 */

const fs = require('fs');
const path = require('path');
const { createServer } = require('http');

const dev = process.argv.includes('--dev');
process.env.NODE_ENV = dev ? 'development' : 'production';

try {
  require('@next/env').loadEnvConfig(process.cwd(), dev, { info: () => {}, error: console.error });
} catch {
  // Sem @next/env: segue apenas com as variáveis já definidas no ambiente.
}

const next = require('next');
const { Server } = require('socket.io');
const config = require('./server/config');
const { RoomManager } = require('./server/rooms');
const { registerSignaling } = require('./server/signaling');

const port = Number(process.env.PORT) || 3000;
const hostname = '0.0.0.0';

if (!dev && !fs.existsSync(path.join(process.cwd(), '.next', 'BUILD_ID'))) {
  console.error('[server] Build de produção não encontrado. Rode "npm run build" antes de iniciar.');
  process.exit(1);
}

let handle = null;

const httpServer = createServer((req, res) => {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  // Health check do Render: responde direto, sem depender do Next.js.
  if (pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    const body = JSON.stringify({ status: 'ok' });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  // HTTPS obrigatório em produção (o TLS termina no proxy do Render).
  if (config.isProd && req.headers['x-forwarded-proto'] === 'http') {
    res.writeHead(308, { Location: `https://${req.headers.host}${url}` });
    return res.end();
  }

  if (!handle) {
    res.writeHead(503, { 'Retry-After': '2' });
    return res.end('Iniciando...');
  }
  handle(req, res).catch((err) => {
    console.error('[next]', err);
    if (!res.headersSent) res.statusCode = 500;
    res.end('Erro interno');
  });
});

const io = new Server(httpServer, {
  path: '/socket.io',
  // Sem ALLOWED_ORIGIN em produção: somente mesma origem. Em desenvolvimento: liberado.
  cors: {
    origin: config.allowedOrigins.length ? config.allowedOrigins : config.isProd ? false : true,
    methods: ['GET', 'POST'],
  },
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (!origin || !config.allowedOrigins.length) return cb(null, true);
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === req.headers.host;
    } catch {
      sameHost = false;
    }
    cb(null, sameHost || config.allowedOrigins.includes(origin));
  },
  serveClient: false, // o cliente Socket.IO já vem no bundle do site
  maxHttpBufferSize: 1e5,
  // Intervalos maiores economizam bateria no celular e toleram oscilações de rede móvel.
  pingInterval: 20000,
  pingTimeout: 30000,
  transports: ['websocket', 'polling'],
});

// Evita 502 intermitente atrás do proxy do Render: a conexão ociosa deve durar mais que a do proxy.
httpServer.keepAliveTimeout = 120 * 1000;
httpServer.headersTimeout = 125 * 1000;

const manager = new RoomManager();
registerSignaling(io, manager);

const app = next({ dev, hostname: 'localhost', port, httpServer });

(async () => {
  await app.prepare();
  handle = app.getRequestHandler();
  manager.start();
  httpServer.listen(port, hostname, () => {
    console.log(`Servidor rodando em http://${hostname}:${port}`);
  });
})().catch((err) => {
  console.error('[server] Falha ao iniciar:', err);
  process.exit(1);
});

// Encerramento gracioso (Render envia SIGTERM a cada novo deploy).
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} recebido: encerrando com segurança...`);
  const force = setTimeout(() => {
    console.error('[server] Tempo esgotado; forçando saída.');
    process.exit(1);
  }, 10000);
  force.unref();
  manager.stop();
  try {
    io.emit('server:shutdown');
  } catch {
    // ignora
  }
  // io.close() desconecta todos os clientes e fecha também o servidor HTTP.
  io.close(() => {
    console.log('[server] Encerrado.');
    process.exit(0);
  });
  setTimeout(() => {
    if (typeof httpServer.closeIdleConnections === 'function') httpServer.closeIdleConnections();
  }, 1000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[server] unhandledRejection', err));
process.on('uncaughtException', (err) => console.error('[server] uncaughtException', err));
