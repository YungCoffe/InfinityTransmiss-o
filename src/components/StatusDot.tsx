const MAP = {
  connecting: ['Conectando', 'bg-amber-400 animate-pulse'],
  connected: ['Conectado', 'bg-emerald-500'],
  reconnecting: ['Reconectando', 'bg-amber-400 animate-pulse'],
  disconnected: ['Desconectado', 'bg-zinc-400'],
} as const;

export type Status = keyof typeof MAP;

export function StatusDot({ status, showLabel = true, className = '' }: { status: Status; showLabel?: boolean; className?: string }) {
  const [label, color] = MAP[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${className}`} title={label}>
      <span className={`h-2.5 w-2.5 rounded-full border border-ink ${color}`} />
      {showLabel ? label : <span className="sr-only">{label}</span>}
    </span>
  );
}
