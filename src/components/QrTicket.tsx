import { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { useSignMessage } from 'wagmi';
import { shortAddr } from '../showup-contract';

/** Signed ticket payload encoded in the QR. */
export interface TicketPayload {
  /** attendee wallet address */
  a: string;
  /** contract address (checksummed) */
  k: string;
  /** eventId as decimal string */
  e: string;
  /** chainId as number */
  c: number;
  /** unix timestamp (seconds) of signing */
  t: number;
  /** personal_sign signature */
  s: string;
}

/** Build the human-readable message that is signed. Must match scanner exactly. */
export function buildTicketMessage(
  contractAddress: string,
  eventId: bigint,
  chainId: number,
  timestamp: number,
): string {
  return `ShowUp check-in | contract ${contractAddress} | event ${eventId.toString()} | chain ${chainId} | ${timestamp}`;
}

/** Validity window: ticket is good for 60 seconds after signing. */
export const TICKET_VALID_SECS = 60;

const RING_R    = 20;
const RING_CIRC = 2 * Math.PI * RING_R;

interface Props {
  address:         `0x${string}`;
  contractAddress: `0x${string}`;
  eventId:         bigint;
  chainId:         number;
}

export function QrTicket({ address, contractAddress, eventId, chainId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // null = no ticket yet / expired; non-null = active signed ticket
  const [payload,   setPayload]   = useState<TicketPayload | null>(null);
  const [secsLeft,  setSecsLeft]  = useState(0);
  const [signing,   setSigning]   = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const { signMessageAsync } = useSignMessage();

  /** Sign once and produce a new ticket payload. */
  const doSign = useCallback(async () => {
    setSigning(true);
    setSignError(null);
    try {
      const t   = Math.floor(Date.now() / 1000);
      const msg = buildTicketMessage(contractAddress, eventId, chainId, t);
      const sig = await signMessageAsync({ message: msg });
      setPayload({ a: address, k: contractAddress, e: eventId.toString(), c: chainId, t, s: sig });
      setSecsLeft(TICKET_VALID_SECS);
    } catch {
      setSignError('Signature cancelled.');
    } finally {
      setSigning(false);
    }
  }, [address, contractAddress, eventId, chainId, signMessageAsync]);

  // Countdown tick — once we have a payload, count down every second
  useEffect(() => {
    if (!payload) return;
    const id = setInterval(() => {
      setSecsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          setPayload(null); // ticket expired — show "Tap to refresh"
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [payload]);

  // Render QR canvas whenever payload changes
  useEffect(() => {
    if (!canvasRef.current || !payload) return;
    void QRCode.toCanvas(canvasRef.current, JSON.stringify(payload), {
      width: 220,
      margin: 2,
      color: { dark: '#122d45', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  }, [payload]);

  // ── Ring progress ──────────────────────────────────────────────────────────
  const fraction   = secsLeft / TICKET_VALID_SECS;
  const dashOffset = RING_CIRC * (1 - fraction);
  const ringColor  = secsLeft <= 10 ? '#ba2b4c' : secsLeft <= 20 ? '#e6a817' : '#1a8047';

  // ── States ─────────────────────────────────────────────────────────────────

  // Signing in progress
  if (signing) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div
          className="size-16 rounded-full flex items-center justify-center animate-pulse"
          style={{ background: 'rgba(16,97,166,0.1)' }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M16 4 A12 12 0 0 1 28 16" stroke="var(--accent-hover)" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          Sign in wallet to generate ticket…
        </p>
        <p className="text-xs text-center px-4" style={{ color: 'var(--muted)' }}>
          No gas — proves you own this wallet.
        </p>
      </div>
    );
  }

  // Error state — show retry button
  if (signError) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <p className="text-sm font-semibold text-center" style={{ color: 'var(--danger)' }}>
          {signError}
        </p>
        <button
          onClick={() => { void doSign(); }}
          className="rounded-xl px-5 py-3 text-sm font-semibold text-white active:scale-95"
          style={{ background: 'var(--accent)' }}
        >
          Try again
        </button>
      </div>
    );
  }

  // Expired (or never signed yet) — show "Tap to refresh ticket" prompt
  if (!payload) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <button
          onClick={() => { void doSign(); }}
          className="flex flex-col items-center gap-3 rounded-3xl px-8 py-6 active:scale-95 transition-transform"
          style={{
            background: 'rgba(16,97,166,0.07)',
            border: '2px dashed var(--border-strong)',
            minWidth: 200,
          }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="var(--accent-hover)" strokeWidth="2.5" strokeDasharray="4 3" />
            <path d="M24 14v10l6 4" stroke="var(--accent-hover)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-semibold" style={{ color: 'var(--accent-hover)' }}>
            Tap to refresh ticket
          </span>
          <span className="text-xs text-center" style={{ color: 'var(--muted)' }}>
            Sign once — valid for 60 seconds
          </span>
        </button>
      </div>
    );
  }

  // Active ticket — show QR with countdown ring
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div
        className="rounded-2xl overflow-hidden p-3 relative"
        style={{
          background: '#ffffff',
          boxShadow: '0 4px 24px rgba(18,45,69,0.12)',
        }}
      >
        <canvas ref={canvasRef} />

        {/* Countdown ring — bottom-right corner of QR card */}
        <div
          className="absolute bottom-2 right-2 flex items-center justify-center"
          style={{ width: 48, height: 48 }}
          title={`Expires in ${secsLeft}s`}
        >
          <svg width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="24" cy="24" r={RING_R} fill="none" stroke="rgba(18,45,69,0.1)" strokeWidth="4" />
            <circle
              cx="24" cy="24" r={RING_R}
              fill="none"
              stroke={ringColor}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
            />
          </svg>
          <span
            className="absolute text-xs font-bold tabular-nums"
            style={{ color: ringColor, fontSize: 11, lineHeight: 1 }}
          >
            {secsLeft}s
          </span>
        </div>
      </div>

      <p className="mono text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
        {shortAddr(address)}
      </p>
      <p className="text-xs text-center px-4" style={{ color: 'var(--muted)' }}>
        Show to organizer — expires in {secsLeft}s. Screenshots won't work.
      </p>
    </div>
  );
}
