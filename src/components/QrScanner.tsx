import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { createPublicClient, http, verifyMessage } from 'viem';
import { arcTestnet, arc } from 'viem/chains';
import { AlertTriangle, X } from 'lucide-react';
import { buildTicketMessage, type TicketPayload } from './QrTicket';
import { CHAIN_CONFIG, type SupportedChainId, SHOWUP_ABI } from '../showup-contract';

/**
 * Accept tickets signed at most 60 seconds ago, or up to 30 seconds
 * in the future (phone clock skew tolerance).
 */
const MAX_AGE_SECS    = 60;
const CLOCK_SKEW_SECS = 30;

interface Props {
  eventId:         bigint;
  chainId:         SupportedChainId;
  contractAddress: `0x${string}`;
  onScan:          (address: `0x${string}`) => void;
  onClose:         () => void;
}

const REGION_ID = 'showup-qr-region';

type ScanState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; address: string };

function clientForChain(chainId: SupportedChainId) {
  const chain  = chainId === 5042 ? arc : arcTestnet;
  const rpcUrl = CHAIN_CONFIG[chainId].isTestnet
    ? 'https://rpc.testnet.arc.io'
    : 'https://rpc.mainnet.arc.io';
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function QrScanner({ eventId, chainId, contractAddress, onScan, onClose }: Props) {
  const scannerRef    = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const [cameraErr, setCameraErr] = useState<string | null>(null);
  const [started,   setStarted]   = useState(false);
  const [scanState, setScanState] = useState<ScanState>({ kind: 'idle' });

  useEffect(() => {
    const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (processingRef.current) return;
          processingRef.current = true;
          void handleScan(decoded.trim());
        },
        () => { /* suppress per-frame failures */ },
      )
      .then(() => setStarted(true))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setCameraErr(msg.toLowerCase().includes('permission')
          ? 'Camera permission denied.'
          : 'Could not start camera.');
      });

    return () => {
      if (scannerRef.current) void scannerRef.current.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleScan(raw: string) {
    setScanState({ kind: 'verifying' });

    // ── 1. Parse JSON ──────────────────────────────────────────────────────
    let ticket: TicketPayload;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('bad shape');
      const p = parsed as Record<string, unknown>;
      if (
        typeof p['a'] !== 'string' ||
        typeof p['k'] !== 'string' ||
        typeof p['e'] !== 'string' ||
        typeof p['c'] !== 'number' ||
        typeof p['t'] !== 'number' ||
        typeof p['s'] !== 'string'
      ) throw new Error('bad shape');
      ticket = { a: p['a'], k: p['k'], e: p['e'], c: p['c'], t: p['t'], s: p['s'] };
    } catch {
      reject('Not a valid ShowUp ticket.');
      return;
    }

    // ── 2. Check contract address ──────────────────────────────────────────
    if (ticket.k.toLowerCase() !== contractAddress.toLowerCase()) {
      reject('Ticket is for a different contract.');
      return;
    }

    // ── 3. Check eventId ───────────────────────────────────────────────────
    if (ticket.e !== eventId.toString()) {
      reject(`Ticket is for event ${ticket.e}, not this event (${eventId}).`);
      return;
    }

    // ── 4. Check chainId ───────────────────────────────────────────────────
    if (ticket.c !== chainId) {
      reject(`Ticket is for chain ${ticket.c}, not this chain (${chainId}).`);
      return;
    }

    // ── 5. Check timestamp (±30s clock skew, max 60s old) ─────────────────
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - ticket.t; // negative if ticket is "in the future" (clock skew)
    if (ageSec < -CLOCK_SKEW_SECS) {
      reject("Ticket time is ahead — check the phone's clock.");
      return;
    }
    if (ageSec > MAX_AGE_SECS) {
      reject('Ticket expired — ask attendee to refresh their QR.');
      return;
    }

    // ── 6. Verify signature ───────────────────────────────────────────────
    const message = buildTicketMessage(ticket.k, BigInt(ticket.e), ticket.c, ticket.t);
    let ok = false;
    try {
      ok = await verifyMessage({
        address:   ticket.a as `0x${string}`,
        message,
        signature: ticket.s as `0x${string}`,
      });
    } catch {
      reject('Signature verification failed.');
      return;
    }
    if (!ok) {
      reject('Signature does not match the wallet address on the ticket.');
      return;
    }

    // ── 7. Pre-flight: isRsvped + isCheckedIn ─────────────────────────────
    try {
      const client = clientForChain(chainId);
      const attendee = ticket.a as `0x${string}`;

      const [rsvped, checkedIn] = await Promise.all([
        client.readContract({
          address: contractAddress, abi: SHOWUP_ABI,
          functionName: 'isRsvped', args: [eventId, attendee],
        }),
        client.readContract({
          address: contractAddress, abi: SHOWUP_ABI,
          functionName: 'isCheckedIn', args: [eventId, attendee],
        }),
      ]);

      if (!rsvped) {
        reject('Not RSVPed for this event.');
        return;
      }
      if (checkedIn) {
        reject('Already checked in.');
        return;
      }
    } catch {
      // If the RPC call fails, let the transaction try — don't block the flow.
      // The contract will revert with the right reason if needed.
    }

    // ── All checks passed ──────────────────────────────────────────────────
    setScanState({ kind: 'ok', address: ticket.a });
    if (scannerRef.current) void scannerRef.current.stop().catch(() => undefined);
    setTimeout(() => onScan(ticket.a as `0x${string}`), 600);
  }

  function reject(message: string) {
    setScanState({ kind: 'error', message });
    setTimeout(() => {
      setScanState({ kind: 'idle' });
      processingRef.current = false;
    }, 3000);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#000' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 pt-4 pb-3"
        style={{ background: 'rgba(0,0,0,0.75)' }}
      >
        <p className="text-white font-semibold">Scan ticket QR</p>
        <button onClick={onClose} className="text-white p-1">
          <X className="size-6" />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 relative flex items-center justify-center">
        <div id={REGION_ID} className="w-full" style={{ maxWidth: 360 }} />

        {!started && !cameraErr && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/70 text-sm">Starting camera…</p>
          </div>
        )}

        {cameraErr && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8">
            <AlertTriangle className="size-8 text-yellow-400" />
            <p className="text-white text-sm text-center">{cameraErr}</p>
            <button
              onClick={onClose}
              className="rounded-xl px-5 py-3 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Use manual input instead
            </button>
          </div>
        )}

        {scanState.kind === 'verifying' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2"
            style={{ background: 'rgba(0,0,0,0.7)' }}
          >
            <div className="size-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            <p className="text-white text-sm">Verifying…</p>
          </div>
        )}

        {scanState.kind === 'error' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8"
            style={{ background: 'rgba(0,0,0,0.8)' }}
          >
            <AlertTriangle className="size-10 text-yellow-400" />
            <p className="text-white font-semibold text-center">{scanState.message}</p>
            <p className="text-white/60 text-xs text-center">Resuming scan in 3s…</p>
          </div>
        )}

        {scanState.kind === 'ok' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: 'rgba(0,0,0,0.8)' }}
          >
            <div
              className="size-16 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(26,128,71,0.3)', border: '2px solid #1a8047' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5L19 7" stroke="#1a8047" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-white font-semibold">Ticket verified!</p>
            <p className="mono text-white/70 text-sm">
              {scanState.address.slice(0, 6)}…{scanState.address.slice(-4)}
            </p>
          </div>
        )}
      </div>

      <div className="pb-8 px-4 text-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <p className="text-white/50 text-xs pt-3">
          Ticket must be signed by the attendee's wallet, valid for 60s.
        </p>
      </div>
    </div>
  );
}
