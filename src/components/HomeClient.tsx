'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from './Logo';
import Snow from './Snow';
import { Icon } from './Icon';
import { ChristmasCountdown } from './Christmas';
import { StatusDot } from './StatusDot';
import { CHRISTMAS } from '@/lib/theme';
import { connectSocket, getSocket, request } from '@/lib/socket';
import { lsGet, lsSet, normalizeCode } from '@/lib/utils';
import type { AckFail, CreateOk } from '@/lib/types';

const CREATE_ERRORS: Record<string, string> = {
  offline: 'Servidor offline. Verifique sua internet e tente de novo.',
  connection: 'Não foi possível criar a sala. Tente de novo.',
  rate: 'Você criou salas demais em pouco tempo. Aguarde alguns minutos.',
  busy: 'O servidor atingiu o limite de salas ativas. Tente de novo em alguns minutos.',
};

const FEATURES: [string, string][] = [
  ['Qualidade máxima', 'Até 4K e 60 fps, com ajuste automático à sua internet e ao seu aparelho.'],
  ['Tela, câmera e áudio', 'Compartilhe a tela, use a câmera e o microfone, ou junte tudo numa transmissão só.'],
  ['Baixa latência', 'O vídeo vai direto de um navegador para o outro, com WebRTC.'],
  ['PC e celular', 'Assista pelo celular ou transmita com a câmera dele. Nada é gravado.'],
];

export default function HomeClient() {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [snow, setSnow] = useState(true);
  const [server, setServer] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    setName(lsGet('itx:name') ?? '');
    setSnow(lsGet('itx:snow') !== 'off');
    // Indicador de servidor/WebSocket no rodapé (também é um teste rápido do Socket.IO).
    // A conexão espera o navegador ficar ocioso para não competir com o carregamento da página.
    const s = getSocket();
    const up = () => setServer('connected');
    const down = () => setServer('disconnected');
    s.on('connect', up);
    s.on('disconnect', down);
    const w = window as any;
    const run = () => connectSocket().then(up).catch(down);
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 2500 }) : setTimeout(run, 800);
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else clearTimeout(id);
      s.off('connect', up);
      s.off('disconnect', down);
    };
  }, []);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const socket = await connectSocket();
      const clean = name.trim().slice(0, 24) || 'Apresentador';
      const res = await request<CreateOk | AckFail>(socket, 'room:create', { name: clean, password: usePassword && password ? password : undefined });
      if (!res.ok) {
        setCreateError(CREATE_ERRORS[res.error === 'RATE_LIMITED' ? 'rate' : res.error === 'SERVER_BUSY' ? 'busy' : 'connection']);
        return;
      }
      lsSet('itx:name', clean);
      lsSet(`itx:host:${res.code}`, res.hostKey);
      router.push(`/sala/${res.code}`);
    } catch (err) {
      setCreateError(CREATE_ERRORS[err instanceof Error && err.message === 'offline' ? 'offline' : 'connection']);
    } finally {
      setCreating(false);
    }
  }

  function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!c) {
      setCodeError('Código inválido. Use 6 letras ou números, como AB3X9K, ou cole o link da sala.');
      return;
    }
    setCodeError(null);
    router.push(`/sala/${c}`);
  }

  function toggleSnow() {
    setSnow((v) => {
      lsSet('itx:snow', v ? 'off' : 'on');
      return !v;
    });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="candy" aria-hidden="true" />
      <header className="border-b-2 border-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 pt-5">
          <Logo />
          <span className="hidden text-sm font-bold sm:block">Sem anúncios. Nada é gravado.</span>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-brand-600 text-white">
          {CHRISTMAS && <Snow active={snow} />}
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute -bottom-32 -right-24 w-[640px] max-w-none text-black opacity-20" fill="none" stroke="currentColor" strokeWidth="0.5" aria-hidden="true">
            <path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8" />
          </svg>
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <h1 className="display text-[2.7rem] sm:text-7xl">
                <span className="block">infinity</span>
                <span className="block">Transmissão</span>
              </h1>
              <p className="mt-5 max-w-md text-xl font-bold sm:text-2xl">Assista telas com amigos em tempo real.</p>
              {CHRISTMAS && (
                <p className="mt-3 max-w-md font-medium text-white/90">Junte a galera, ligue a transmissão e passe as festas juntos, mesmo à distância.</p>
              )}
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="chip">Até 4K e 60 fps</span>
                <span className="chip">Câmera e microfone</span>
                <span className="chip">PC e celular</span>
                {CHRISTMAS && <ChristmasCountdown />}
              </div>
              {CHRISTMAS && (
                <button type="button" onClick={toggleSnow} aria-pressed={snow} className="chip mt-4 cursor-pointer hover:bg-zinc-100">
                  <Icon name="snow" size={14} />
                  {snow ? 'Desligar a neve' : 'Ligar a neve'}
                </button>
              )}
            </div>

            <div className="card p-5 text-black sm:p-6">
              <h2 className="text-xl font-black">Comece uma transmissão</h2>
              {!showCreate ? (
                <button type="button" className="btn btn-primary btn-lg mt-3 w-full" onClick={() => setShowCreate(true)}>
                  <Icon name="monitor" size={20} />
                  Criar sala
                </button>
              ) : (
                <form onSubmit={createRoom} className="mt-3 space-y-3">
                  <label className="block text-sm font-bold">
                    Seu nome
                    <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Como os amigos vão te ver" autoComplete="nickname" autoFocus />
                  </label>
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input type="checkbox" className="h-4 w-4" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
                    Proteger a sala com senha
                  </label>
                  {usePassword && (
                    <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} placeholder="Senha da sala" autoComplete="new-password" aria-label="Senha da sala" />
                  )}
                  <button type="submit" className="btn btn-primary btn-lg w-full" disabled={creating || (usePassword && !password)}>
                    {creating ? 'Criando sala...' : 'Criar e abrir a sala'}
                  </button>
                </form>
              )}
              {createError && (
                <p role="alert" className="mt-3 rounded-xl border-2 border-ink bg-brand-50 px-3 py-2 text-sm font-semibold">
                  {createError}
                </p>
              )}

              <div className="my-5 flex items-center gap-3 text-sm font-bold text-zinc-500" aria-hidden="true">
                <span className="h-0.5 flex-1 bg-ink/15" />
                ou
                <span className="h-0.5 flex-1 bg-ink/15" />
              </div>

              <h2 className="text-xl font-black">Entre em uma sala</h2>
              <form onSubmit={joinRoom} className="mt-3 space-y-2">
                <input
                  className="input text-center font-mono text-2xl font-black uppercase tracking-[0.3em] placeholder:tracking-normal"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError(null);
                  }}
                  placeholder="AB3X9K"
                  maxLength={80}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Código da sala"
                />
                {codeError && (
                  <p role="alert" className="text-sm font-semibold text-brand-700">
                    {codeError}
                  </p>
                )}
                <button type="submit" className="btn btn-dark btn-lg w-full">
                  Entrar
                </button>
              </form>
            </div>
          </div>
        </section>
        <div className="candy" aria-hidden="true" />

        <section className="cv mx-auto max-w-6xl px-4 py-10">
          <dl className="grid divide-y-2 divide-ink overflow-hidden rounded-2xl border-2 border-ink sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x-2">
            {FEATURES.map(([title, text]) => (
              <div key={title} className="p-5 sm:[&:nth-child(n+3)]:border-t-2 sm:[&:nth-child(n+3)]:border-ink lg:[&:nth-child(n+3)]:border-t-0">
                <dt className="text-lg font-black">{title}</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-700">{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="cv mx-auto max-w-6xl px-4 pb-12">
          <h2 className="text-2xl font-black">Antes de transmitir</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border-2 border-ink p-4">
              <h3 className="font-black">Mantenha a aba aberta</h3>
              <p className="mt-1 text-sm font-medium text-zinc-700">No computador a transmissão continua se você trocar de aba ou minimizar o navegador, mas para se a aba for fechada. Nada é capturado com o site fechado.</p>
            </div>
            <div className="rounded-2xl border-2 border-ink p-4">
              <h3 className="font-black">No celular</h3>
              <p className="mt-1 text-sm font-medium text-zinc-700">Você assiste e também pode transmitir pela câmera e pelo microfone. Compartilhar a tela depende do sistema e do navegador e, na maioria dos celulares, não está disponível.</p>
            </div>
            <div className="rounded-2xl border-2 border-ink p-4">
              <h3 className="font-black">Áudio, câmera e microfone</h3>
              <p className="mt-1 text-sm font-medium text-zinc-700">No Chrome e no Edge, escolha uma aba e marque “Compartilhar áudio da aba”. Câmera e microfone são opcionais e só ligam se você permitir.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-ink">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-sm font-semibold">
          <span>Sem anúncios. Sem rastreamento. Nada é gravado.</span>
          <span className="inline-flex items-center gap-2">
            Servidor:
            <StatusDot status={server === 'connected' ? 'connected' : server === 'connecting' ? 'connecting' : 'disconnected'} />
          </span>
        </div>
      </footer>
    </div>
  );
}
