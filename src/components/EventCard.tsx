import { useReadContract } from 'wagmi';
import { Users, CalendarDays, Loader2 } from 'lucide-react';
import {
  showupContract,
  coerceEvent,
  formatUsdc6,
  formatDate,
  type SupportedChainId,
  CHAIN_CONFIG,
} from '../showup-contract';
import { useClock } from '../hooks/useClock';

interface Props {
  eventId: bigint;
  chainId: SupportedChainId;
  onClick: (id: bigint) => void;
}

export function EventCard({ eventId, chainId, onClick }: Props) {
  const cfg = CHAIN_CONFIG[chainId];
  const CONTRACT = showupContract(chainId);
  const nowSec = useClock();

  const { data: rawEv, isLoading } = useReadContract({
    ...CONTRACT,
    functionName: 'getEvent',
    args: [eventId],
    chainId,
  });

  const ev = coerceEvent(rawEv);

  if (isLoading) {
    return (
      <div
        className="rounded-2xl p-4 flex items-center justify-center h-24"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Loader2 className="size-4 animate-spin" style={{ color: 'var(--muted)' }} />
      </div>
    );
  }

  if (!ev || !ev.name) return null;

  const hasStarted = nowSec >= ev.startTime;
  const isEnded    = nowSec > ev.checkInDeadline;
  const seatsLeft  = ev.capacity - ev.rsvpCount;

  const statusLabel = isEnded ? 'Ended' : hasStarted ? 'Doors open' : 'Open for RSVP';
  const statusColor = isEnded ? 'var(--muted)' : hasStarted ? 'var(--accent-hover)' : 'var(--success)';

  return (
    <button
      onClick={() => onClick(eventId)}
      className="w-full text-left rounded-2xl p-4 transition-all hover:scale-[1.01] active:scale-[0.99]"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 12px rgba(18,45,69,0.05)',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="display font-semibold text-base leading-tight" style={{ color: 'var(--ink)' }}>
          {ev.name}
        </p>
        <span className="shrink-0 text-xs font-semibold" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1">
          <CalendarDays className="size-3.5" />
          {formatDate(ev.startTime)}
        </span>
        <span className="flex items-center gap-1">
          <Users className="size-3.5" />
          {seatsLeft > 0 ? `${seatsLeft} seats left` : 'Full'}
        </span>
        <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>
          {formatUsdc6(ev.deposit)} USDC
        </span>
        {cfg.isTestnet && (
          <span className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>testnet</span>
        )}
      </div>
    </button>
  );
}
