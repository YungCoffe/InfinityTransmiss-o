'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { lsGet } from '@/lib/utils';
import type { Snapshot } from '@/lib/room-session';

const ERRORS = {
  'wrong-password': 'Senha incorreta. Confira com o apresentador.',
  'password-required': 'Esta sala exige senha.',
  connection: 'Não foi possível entrar agora. Tente de novo.',
} as const;

export default function JoinForm({ snap, onJoin }: { snap: Snapshot; onJoin: (name: string, password?: string) => void }) {
  const info = snap.info;
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => setName(lsGet('itx:name') ?? ''), []);
  if (!info) return null;
  const busy = snap.phase === 'joining';
  const error = snap.joinError ? ERRORS[snap.joinError] : null;

  return (
    <div className="min-h-dvh">
      <div className="candy" aria-hidden="true" />
      <main className="mx-auto grid max-w-md gap-6 px-4 py-10">
        <Link href="/" aria-label="Voltar ao início" className="justify-self-center">
          <Logo />
        </Link>
        <form
          className="card space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            onJoin(name, password || undefined);
          }}
        >
          <div>
            <h1 className="text-2xl font-black">Entrar na sala</h1>
            <p className="mt-1 text-sm font-medium text-zinc-700">
              Sala <span className="font-mono font-black">{info.code}</span> de {info.hostName}. {info.streaming ? 'A transmissão está ao vivo.' : 'A transmissão ainda não começou.'}
            </p>
          </div>
          <label className="block text-sm font-bold">
            Seu nome
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Como os outros vão te ver" autoComplete="nickname" required autoFocus />
          </label>
          {info.passwordRequired && (
            <label className="block text-sm font-bold">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="lock" size={14} />
                Senha da sala
              </span>
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} autoComplete="off" required />
            </label>
          )}
          {error && (
            <p role="alert" className="rounded-xl border-2 border-ink bg-brand-50 px-3 py-2 text-sm font-semibold">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy || !name.trim()}>
            {busy ? 'Entrando...' : 'Entrar na sala'}
          </button>
          <p className="text-center text-xs font-medium text-zinc-600">Nada é gravado. Você pode sair quando quiser.</p>
        </form>
      </main>
    </div>
  );
}
