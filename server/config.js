'use strict';

// Todas as variáveis são opcionais. Valores padrão servem para a maioria dos casos.

const crypto = require('crypto');

const int = (value, fallback, min, max) => {
  const n = Number.parseInt(String(value == null ? '' : value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter((s) => s && !s.includes('seu-dominio'));

/** ICE servers entregues somente a quem entra numa sala (as credenciais TURN não vão no bundle do front-end). */
function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];
  const urls = (process.env.TURN_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    list.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return list;
}

module.exports = {
  isProd: process.env.NODE_ENV === 'production',
  // As salas vivem só na memória; por isso um segredo novo a cada início do servidor é suficiente.
  sessionSecret: crypto.randomBytes(32).toString('hex'),
  allowedOrigins,
  roomInactivityMs: int(process.env.ROOM_INACTIVITY_MINUTES, 60, 1, 1440) * 60 * 1000,
  // Conexões diretas (P2P) saem do computador de quem transmite: este limite protege o upload dele.
  maxViewers: int(process.env.MAX_VIEWERS, 8, 1, 50),
  maxRooms: int(process.env.MAX_ROOMS, 200, 1, 5000),
  maxConnectionsPerIp: int(process.env.MAX_CONNECTIONS_PER_IP, 40, 1, 500),
  reconnectGraceMs: 30 * 1000,
  removeDisconnectedAfterMs: 2 * 60 * 1000,
  iceServers,
};
