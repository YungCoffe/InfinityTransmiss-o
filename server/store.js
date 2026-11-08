'use strict';

// Persistência opcional (Prisma + SQLite) apenas dos metadados das salas.
// Se o banco não estiver disponível, o servidor continua funcionando só com memória.

let prisma = null;
let enabled = false;

async function init() {
  try {
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({ log: ['error'] });
    // Mantém a tabela criada sem depender da CLI do Prisma em tempo de execução.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Room" (
        "code" TEXT NOT NULL PRIMARY KEY,
        "hostName" TEXT NOT NULL,
        "hostKeyHash" TEXT NOT NULL,
        "passwordHash" TEXT,
        "status" TEXT NOT NULL DEFAULT 'open',
        "createdAt" BIGINT NOT NULL,
        "lastActivityAt" BIGINT NOT NULL,
        "closedAt" BIGINT
      )`);
    enabled = true;
    console.log('[db] SQLite pronto.');
  } catch (err) {
    enabled = false;
    const msg = err && err.message ? String(err.message).split('\n')[0] : String(err);
    console.warn('[db] indisponível; as salas ficarão apenas em memória.', msg);
  }
}

async function safe(fn, fallback) {
  if (!enabled) return fallback;
  try {
    return await fn();
  } catch (err) {
    console.warn('[db]', err && err.message ? String(err.message).split('\n')[0] : err);
    return fallback;
  }
}

module.exports = {
  init,
  save: (room) =>
    safe(
      () =>
        prisma.room.upsert({
          where: { code: room.code },
          create: {
            code: room.code,
            hostName: room.hostName,
            hostKeyHash: room.hostKeyHash,
            passwordHash: room.passwordHash,
            status: 'open',
            createdAt: BigInt(room.createdAt),
            lastActivityAt: BigInt(room.lastActivityAt),
          },
          update: { lastActivityAt: BigInt(room.lastActivityAt) },
        }),
      null
    ),
  load: (code) =>
    safe(async () => {
      const r = await prisma.room.findUnique({ where: { code } });
      if (!r) return null;
      return { ...r, createdAt: Number(r.createdAt), lastActivityAt: Number(r.lastActivityAt) };
    }, null),
  exists: (code) => safe(async () => !!(await prisma.room.findUnique({ where: { code }, select: { code: true } })), false),
  touch: (code, ts) => safe(() => prisma.room.update({ where: { code }, data: { lastActivityAt: BigInt(ts) } }), null),
  close: (code) => safe(() => prisma.room.update({ where: { code }, data: { status: 'closed', closedAt: BigInt(Date.now()) } }), null),
  purge: () =>
    safe(
      () =>
        prisma.room.deleteMany({
          where: {
            OR: [
              { status: 'closed', closedAt: { lt: BigInt(Date.now() - 24 * 3600 * 1000) } },
              { lastActivityAt: { lt: BigInt(Date.now() - 7 * 24 * 3600 * 1000) } },
            ],
          },
        }),
      null
    ),
  disconnect: () => safe(() => prisma.$disconnect(), null),
};
