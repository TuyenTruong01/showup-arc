import { useState, useEffect } from 'react';
import { ConnectKitButton } from 'connectkit';
import { useReadContract, useAccount, useSwitchChain } from 'wagmi';
import { Plus, CalendarDays, Loader2, TriangleAlert } from 'lucide-react';
import { CreateEventSheet } from './components/CreateEventSheet';
import { EventCard } from './components/EventCard';
import { EventDetail } from './components/EventDetail';
import {
  SUPPORTED_CHAIN_IDS,
  CHAIN_CONFIG,
  DEFAULT_CHAIN_ID,
  showupContract,
  type SupportedChainId,
} from './showup-contract';

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------
function getUrlEventId(): bigint | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('event');
  if (!raw) return null;
  try { return BigInt(raw); } catch { return null; }
}

function buildEventUrl(eventId: bigint): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}?event=${eventId.toString()}`;
}

export default function App() {
  const [selectedEventId, setSelectedEventId] = useState<bigint | null>(getUrlEventId);
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chainId, setChainId] = useState<SupportedChainId>(DEFAULT_CHAIN_ID);

  const { chainId: walletChain } = useAccount();
  const { switchChain } = useSwitchChain();

  // Sync URL when navigating
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedEventId !== null) {
      url.searchParams.set('event', selectedEventId.toString());
    } else {
      url.searchParams.delete('event');
    }
    window.history.replaceState({}, '', url.toString());
  }, [selectedEventId]);

  // Warn if wallet is on a different supported chain
  const walletOnSupportedChain = walletChain !== undefined && SUPPORTED_CHAIN_IDS.includes(walletChain as SupportedChainId);
  const walletChainMismatch = walletChain !== undefined && walletChain !== chainId && walletOnSupportedChain;

  const cfg = CHAIN_CONFIG[chainId];
  const CONTRACT = showupContract(chainId);

  const { data: eventCount, isLoading: isCountLoading } = useReadContract({
    ...CONTRACT,
    functionName: 'eventCount',
    chainId,
    scopeKey: `eventCount-${chainId}-${refreshKey}`,
  });

  const count = Number(eventCount ?? 0n);
  const shareUrl = selectedEventId !== null ? buildEventUrl(selectedEventId) : '';

  if (selectedEventId !== null) {
    return (
      <main className="min-h-dvh px-4 py-6 max-w-md mx-auto">
        <EventDetail
          eventId={selectedEventId}
          chainId={chainId}
          onBack={() => setSelectedEventId(null)}
          shareUrl={shareUrl}
        />
      </main>
    );
  }

  return (
    <main className="min-h-dvh px-4 py-6 max-w-md mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>ShowUp</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            RSVP with a USDC deposit
          </p>
        </div>
        <ConnectKitButton />
      </header>

      {/* Network selector */}
      <div className="flex gap-2 mb-4">
        {SUPPORTED_CHAIN_IDS.map((cid) => {
          const c = CHAIN_CONFIG[cid];
          const disabled = !c.showupAddress;
          return (
            <button
              key={cid}
              disabled={disabled}
              onClick={() => setChainId(cid)}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: chainId === cid ? 'var(--accent)' : 'var(--surface-muted)',
                color: chainId === cid ? '#fff' : 'var(--ink-2)',
              }}
            >
              {c.label}
              {disabled && ' (soon)'}
            </button>
          );
        })}
      </div>

      {/* Chain mismatch nudge */}
      {walletChainMismatch && (
        <div
          className="rounded-2xl p-3 mb-4 flex items-center gap-2"
          style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.15)' }}
        >
          <TriangleAlert className="size-4 shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-xs font-medium flex-1" style={{ color: 'var(--danger)' }}>
            Your wallet is on a different chain.
          </p>
          <button
            onClick={() => switchChain({ chainId })}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: 'var(--danger)' }}
          >
            Switch to {cfg.label}
          </button>
        </div>
      )}

      {/* Hero banner */}
      <div
        className="rounded-3xl p-5 mb-5"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 24px rgba(18,45,69,0.08)',
        }}
      >
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
            {isCountLoading ? '—' : String(count)}
          </span>
          <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>
            event{count !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          Attendees lock a USDC deposit to RSVP. Show up = get it back + a share of no-shows.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)', minHeight: 44 }}
        >
          <Plus className="size-4" /> Create event
        </button>
      </div>

      {/* Event list */}
      <div className="flex items-center gap-1.5 mb-3">
        <CalendarDays className="size-4" style={{ color: 'var(--muted)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
          ALL EVENTS
        </span>
      </div>

      {isCountLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin" style={{ color: 'var(--muted)' }} />
        </div>
      ) : count === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CalendarDays className="size-10 mb-3 opacity-30" style={{ color: 'var(--muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>No events yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>Create the first one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {Array.from({ length: count }, (_, i) => BigInt(count - i)).map((id) => (
            <EventCard
              key={id.toString()}
              eventId={id}
              chainId={chainId}
              onClick={setSelectedEventId}
            />
          ))}
        </div>
      )}

      <CreateEventSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
        chainId={chainId}
      />
    </main>
  );
}
