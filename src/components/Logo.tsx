import { Icon } from './Icon';
import { SantaHat } from './Christmas';
import { CHRISTMAS } from '@/lib/theme';

export default function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex select-none items-center gap-2.5 ${className}`}>
      <span className="relative inline-grid h-10 w-10 place-items-center rounded-xl border-2 border-ink bg-brand-600 text-white shadow-[2px_2px_0_0_#000]">
        <Icon name="infinity" size={26} strokeWidth={2.6} />
        {CHRISTMAS && <SantaHat className="absolute -left-2.5 -top-4 h-7 w-7 -rotate-[16deg]" />}
      </span>
      <span className="text-lg font-black tracking-tight sm:text-xl">infinityTransmissão</span>
    </span>
  );
}
