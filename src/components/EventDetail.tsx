import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Loader2,
  ExternalLink,
  Users,
  CheckCircle2,
  Copy,
  Check,
  ScanLine,
  QrCode,
  Gift,
} from 'lucide-react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { arcTestnet, arc } from 'viem/chains';
import { erc20Abi } from 'viem';
import { toast } from 'sonner';
import {
  showupContract,
  CHAIN_CONFIG,
  coerceEvent,
  formatUsdc6,
  shortAddr,
  formatDate,
  type SupportedChainId,
} from '../showup-contract';
import { useClock } from '../hooks/useClock';
import { QrTicket } from './QrTicket';
import { QrScanner } from './QrScanner';
import { AttendeeList } from './AttendeeList';
import { Countdown } from './Countdown';

interface Props {
  eventId: bigint;
  chainId: SupportedChainId;
  onBack: () => void;
  shareUrl: string;
}

type Tab = 'info' | 'attendees';

const CLAIMED_ABI = parseAbiItem(
  'event Claimed(uint256 indexed eventId, address indexed attendee, uint256 amount)',
);

// ── Public client for reading Claimed event ──────────────────────────────────
function publicClientForChain(chainId: SupportedChainId) {
  const chain  = chainId === 5042 ? arc : arcTestnet;
  const rpcUrl = CHAIN_CONFIG[chainId].isTestnet
    ? 'https://rpc.testnet.arc.io'
    : 'https://rpc.mainnet.arc.io';
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function EventDetail({ eventId, chainId, onBack, shareUrl }: Props) {
  const cfg      = CHAIN_CONFIG[chainId];
  const CONTRACT = showupContract(chainId);

  const { address, chainId: walletChain } = useAccount();
  const { switchChain } = useSwitchChain();
  const wrongChain = walletChain !== chainId;

  // ── Live clock ────────────────────────────────────────────────────────────
  const nowSec = useClock();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tab,             setTab]             = useState<Tab>('info');
  const [showTicket,      setShowTicket]      = useState(false);
  const [showScanner,     setShowScanner]     = useState(false);
  const [checkInAddress,  setCheckInAddress]  = useState('');
  const [copied,          setCopied]          = useState(false);
  const [attendeeRefresh, setAttendeeRefresh] = useState(0);
  // Amount from on-chain Claimed event log (for "You received X USDC" display)
  const [claimedAmount,   setClaimedAmount]   = useState<bigint | null>(null);

  // ── Contract reads ────────────────────────────────────────────────────────
  const { data: rawEv, refetch: refetchEvent } = useReadContract({
    ...CONTRACT,
    functionName: 'getEvent',
    args: [eventId],
    chainId,
  });
  const ev = coerceEvent(rawEv);

  const zero = '0x0000000000000000000000000000000000000000' as const;
  const who  = address ?? zero;

  const { data: _userRsvped, refetch: refetchRsvp } = useReadContract({
    ...CONTRACT, functionName: 'isRsvped', args: [eventId, who], chainId,
    query: { enabled: !!address },
  });
  const userRsvped = _userRsvped === true;

  const { data: _userCheckedIn, refetch: refetchCheckedIn } = useReadContract({
    ...CONTRACT, functionName: 'isCheckedIn', args: [eventId, who], chainId,
    query: { enabled: !!address },
  });
  const userCheckedIn = _userCheckedIn === true;

  const { data: _userClaimed, refetch: refetchClaimed } = useReadContract({
    ...CONTRACT, functionName: 'hasClaimed', args: [eventId, who], chainId,
    query: { enabled: !!address },
  });
  const userClaimed = _userClaimed === true;

  const { data: payout, refetch: refetchPayout } = useReadContract({
    ...CONTRACT, functionName: 'payoutFor', args: [eventId, who], chainId,
    query: { enabled: !!address },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: cfg.usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [who, cfg.showupAddress],
    chainId,
    query: { enabled: !!address },
  });

  // ── Write hooks ───────────────────────────────────────────────────────────
  const { writeContract: writeApprove, data: approveTxHash, isPending: isApprovePending, reset: resetApprove } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });

  const { writeContract: writeRsvp, data: rsvpTxHash, isPending: isRsvpPending, reset: resetRsvp } = useWriteContract();
  const { isLoading: isRsvpConfirming, isSuccess: isRsvpSuccess } = useWaitForTransactionReceipt({ hash: rsvpTxHash });

  const { writeContract: writeCancel, data: cancelTxHash, isPending: isCancelPending, reset: resetCancel } = useWriteContract();
  const { isLoading: isCancelConfirming, isSuccess: isCancelSuccess } = useWaitForTransactionReceipt({ hash: cancelTxHash });

  const { writeContract: writeClaim, data: claimTxHash, isPending: isClaimPending, reset: resetClaim } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: isClaimSuccess } = useWaitForTransactionReceipt({ hash: claimTxHash });

  const { writeContract: writeCheckIn, data: checkInTxHash, isPending: isCheckInPending, reset: resetCheckIn } = useWriteContract();
  const { isLoading: isCheckInConfirming, isSuccess: isCheckInSuccess } = useWaitForTransactionReceipt({ hash: checkInTxHash });

  // ── Helper: refetch everything ────────────────────────────────────────────
  const refetchAll = useCallback(() => {
    void refetchEvent();
    void refetchRsvp();
    void refetchCheckedIn();
    void refetchClaimed();
    void refetchPayout();
    void refetchAllowance();
  }, [refetchEvent, refetchRsvp, refetchCheckedIn, refetchClaimed, refetchPayout, refetchAllowance]);

  // ── 10-second polling ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(refetchAll, 10_000);
    return () => clearInterval(id);
  }, [refetchAll]);

  // ── Status-change refetch (doors open / check-in closes) ──────────────────
  const prevStatus = useRef<'rsvp' | 'open' | 'ended' | null>(null);
  useEffect(() => {
    if (!ev) return;
    const status: 'rsvp' | 'open' | 'ended' =
      nowSec > ev.checkInDeadline ? 'ended' :
      nowSec >= ev.startTime      ? 'open'  : 'rsvp';
    if (prevStatus.current !== null && prevStatus.current !== status) {
      refetchAll();
      setAttendeeRefresh((k) => k + 1);
    }
    prevStatus.current = status;
  }, [nowSec, ev, refetchAll]);

  // ── Auto-proceed: approve → rsvp ─────────────────────────────────────────
  const rsvpTriggeredRef = useRef(false);
  useEffect(() => {
    if (isApproveSuccess && ev && !isRsvpPending && !isRsvpConfirming && !isRsvpSuccess && !rsvpTriggeredRef.current) {
      rsvpTriggeredRef.current = true;
      writeRsvp({ ...CONTRACT, functionName: 'rsvp', args: [eventId] });
    }
    if (!isApproveSuccess) rsvpTriggeredRef.current = false;
  }, [isApproveSuccess, ev, isRsvpPending, isRsvpConfirming, isRsvpSuccess, writeRsvp, CONTRACT, eventId]);

  // ── Side-effects on tx success ────────────────────────────────────────────
  useEffect(() => {
    if (!isRsvpSuccess) return;
    toast.success('RSVPed! Deposit locked.');
    refetchAll();
    resetApprove(); resetRsvp();
  }, [isRsvpSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isCancelSuccess) return;
    toast.success('RSVP cancelled — deposit refunded.');
    refetchAll();
    resetCancel();
  }, [isCancelSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isClaimSuccess) return;
    toast.success('Claimed! Check your wallet.');
    refetchAll();
    resetClaim();
    // Fetch the Claimed event log to get the exact amount
    if (address && ev) {
      const client = publicClientForChain(chainId);
      void client.getLogs({
        address: cfg.showupAddress,
        event: CLAIMED_ABI,
        args: { eventId, attendee: address },
        fromBlock: ev.createdBlock,
      }).then((logs) => {
        if (logs.length > 0) {
          const last = logs[logs.length - 1];
          if (typeof last.args.amount === 'bigint') setClaimedAmount(last.args.amount);
        }
      }).catch(() => undefined);
    }
  }, [isClaimSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isCheckInSuccess) return;
    toast.success(`Checked in ${shortAddr(checkInAddress || '?')}`);
    void refetchEvent();
    setCheckInAddress('');
    setAttendeeRefresh((k) => k + 1);
    resetCheckIn();
  }, [isCheckInSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load claimed amount on mount if already claimed ───────────────────────
  useEffect(() => {
    if (!userClaimed || !address || !ev || claimedAmount !== null) return;
    const client = publicClientForChain(chainId);
    void client.getLogs({
      address: cfg.showupAddress,
      event: CLAIMED_ABI,
      args: { eventId, attendee: address },
      fromBlock: ev.createdBlock,
    }).then((logs) => {
      if (logs.length > 0) {
        const last = logs[logs.length - 1];
        if (typeof last.args.amount === 'bigint') setClaimedAmount(last.args.amount);
      }
    }).catch(() => undefined);
  }, [userClaimed, address, ev, claimedAmount, chainId, cfg.showupAddress, eventId]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const hasStarted = ev ? nowSec >= ev.startTime        : false;
  const isEnded    = ev ? nowSec > ev.checkInDeadline   : false;
  const isFull     = ev ? ev.rsvpCount >= ev.capacity   : false;
  const isOrganizer = !!address && !!ev && address.toLowerCase() === ev.organizer.toLowerCase();
  const deposit    = ev?.deposit ?? 0n;
  const depositFormatted = formatUsdc6(deposit);
  const needsApproval = allowance !== undefined && allowance < deposit;

  const rsvpBusy    = isApprovePending || isApproveConfirming || isRsvpPending || isRsvpConfirming;
  const cancelBusy  = isCancelPending  || isCancelConfirming;
  const claimBusy   = isClaimPending   || isClaimConfirming;
  const checkInBusy = isCheckInPending || isCheckInConfirming;

  const payoutBigint    = typeof payout === 'bigint' ? payout : null;
  const payoutFormatted = payoutBigint && payoutBigint > 0n ? formatUsdc6(payoutBigint) : null;

  // Preview payout (before deadline, using current counts)
  const previewPayout = ev && !isEnded && ev.checkedInCount > 0
    ? formatUsdc6(
        ev.deposit + (ev.deposit * BigInt(ev.rsvpCount - ev.checkedInCount)) / BigInt(ev.checkedInCount),
      )
    : null;
  const previewPayoutAllRefund = ev && !isEnded && ev.checkedInCount === 0 && ev.rsvpCount > 0;

  const claimTxUrl   = claimTxHash   ? `${cfg.explorerBase}/tx/${claimTxHash}`   : null;
  const claimedAmtFmt = claimedAmount !== null ? formatUsdc6(claimedAmount) : null;

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleRsvp() {
    if (wrongChain) { switchChain({ chainId }); return; }
    if (needsApproval) {
      writeApprove({ address: cfg.usdcAddress, abi: erc20Abi, functionName: 'approve', args: [cfg.showupAddress, deposit] });
    } else {
      writeRsvp({ ...CONTRACT, functionName: 'rsvp', args: [eventId] });
    }
  }
  function handleCancelRsvp() {
    if (wrongChain) { switchChain({ chainId }); return; }
    writeCancel({ ...CONTRACT, functionName: 'cancelRsvp', args: [eventId] });
  }
  function handleClaim() {
    if (wrongChain) { switchChain({ chainId }); return; }
    writeClaim({ ...CONTRACT, functionName: 'claim', args: [eventId] });
  }
  function handleCheckIn(addr?: string) {
    const target = (addr ?? checkInAddress).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) { toast.error('Enter a valid 0x address.'); return; }
    if (wrongChain) { switchChain({ chainId }); return; }
    writeCheckIn({ ...CONTRACT, functionName: 'checkIn', args: [eventId, target as `0x${string}`] });
  }

  const handleQrScan = useCallback((scanned: `0x${string}`) => {
    setShowScanner(false);
    setCheckInAddress(scanned);
    handleCheckIn(scanned);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, chainId, wrongChain]);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — check browser permissions.');
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!ev) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin" style={{ color: 'var(--muted)' }} />
      </div>
    );
  }

  // ── Wrong chain banner ────────────────────────────────────────────────────
  const WrongChainBanner = wrongChain && !!address ? (
    <div
      className="rounded-2xl p-3.5 mb-4 flex items-center justify-between gap-3"
      style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--danger)' }}>
        Switch to {cfg.label} to interact
      </p>
      <button
        onClick={() => switchChain({ chainId })}
        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
        style={{ background: 'var(--danger)' }}
      >
        Switch
      </button>
    </div>
  ) : null;

  // ── 2-step RSVP progress indicator ───────────────────────────────────────
  const RsvpProgress = (isApprovePending || isApproveConfirming || (isApproveSuccess && !isRsvpSuccess)) ? (
    <div className="rounded-2xl p-3 mb-3" style={{ background: 'rgba(16,97,166,0.07)' }}>
      <div className="flex items-center gap-3">
        {[
          { label: 'Approve USDC', done: isApproveSuccess, active: isApprovePending || isApproveConfirming },
          { label: 'RSVP',         done: isRsvpSuccess,    active: isRsvpPending    || isRsvpConfirming },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {step.done ? (
              <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
            ) : step.active ? (
              <Loader2 className="size-4 animate-spin" style={{ color: 'var(--accent-hover)' }} />
            ) : (
              <div className="size-4 rounded-full border-2" style={{ borderColor: 'var(--border-strong)' }} />
            )}
            <span className="text-xs font-medium" style={{ color: step.active ? 'var(--ink)' : 'var(--muted)' }}>
              {step.label}
            </span>
            {i === 0 && <div className="w-4 h-px" style={{ background: 'var(--border)' }} />}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const statusLabel = isEnded ? 'Ended' : hasStarted ? 'Doors open' : 'Open for RSVP';
  const statusColor = isEnded ? 'var(--muted)' : hasStarted ? 'var(--accent-hover)' : 'var(--success)';
  const statusBg    = isEnded ? 'rgba(107,101,128,0.1)' : hasStarted ? 'rgba(16,97,166,0.1)' : 'rgba(26,128,71,0.1)';

  // ── My ticket box ─────────────────────────────────────────────────────────
  // Renders a contextual card based on the attendee's state.
  const MyTicketBox = userRsvped ? (() => {
    // State A: claimed — show receipt
    if (userClaimed) {
      return (
        <div
          className="rounded-2xl p-4 mb-4 space-y-2"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Gift className="size-4" style={{ color: 'var(--success)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
              {claimedAmtFmt ? `You received ${claimedAmtFmt} USDC` : 'Payout claimed'}
            </p>
          </div>
          {claimTxUrl && (
            <a
              href={claimTxUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: 'var(--accent-hover)' }}
            >
              View on explorer <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      );
    }

    // State B: ended + checked-in + not yet claimed — claim prompt in ticket box
    if (isEnded && userCheckedIn) {
      return (
        <div
          className="rounded-2xl p-4 mb-4 space-y-3"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {payoutFormatted ? `You showed up — claim ${payoutFormatted} USDC` : 'You showed up — claim your payout'}
            </p>
          </div>
          <button
            disabled={!address || claimBusy || wrongChain}
            onClick={handleClaim}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
            style={{ background: 'var(--success)' }}
          >
            {claimBusy
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Claiming…</span>
              : payoutFormatted ? `Claim ${payoutFormatted} USDC` : 'Claim'}
          </button>
        </div>
      );
    }

    // State C: ended + NOT checked in + at least one person checked in — no-show
    if (isEnded && !userCheckedIn && ev.checkedInCount > 0) {
      return (
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--danger)' }}>
            You didn't check in
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Your deposit was shared with attendees who showed up.
          </p>
        </div>
      );
    }

    // State D: ended + nobody checked in — full refund available
    if (isEnded && ev.checkedInCount === 0) {
      return (
        <div
          className="rounded-2xl p-4 mb-4 space-y-3"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Gift className="size-4" style={{ color: 'var(--accent-hover)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              No check-ins — claim your full refund
            </p>
          </div>
          <button
            disabled={!address || claimBusy || wrongChain}
            onClick={handleClaim}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            {claimBusy
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Claiming…</span>
              : `Claim ${depositFormatted} USDC`}
          </button>
        </div>
      );
    }

    // State E: checked in, event in progress — waiting for deadline
    if (hasStarted && !isEnded && userCheckedIn) {
      return (
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              Checked in ✓ — claim opens when check-in closes
            </p>
          </div>
        </div>
      );
    }

    // State F: RSVPed, not yet started or doors open but not checked in — show ticket
    return (
      <div
        className="rounded-2xl p-4 mb-4"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>My ticket</p>
          <button
            onClick={() => setShowTicket((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold"
            style={{ color: 'var(--accent-hover)' }}
          >
            <QrCode className="size-3.5" />
            {showTicket ? 'Hide QR' : 'Show QR'}
          </button>
        </div>
        {showTicket && address ? (
          <QrTicket
            address={address}
            contractAddress={cfg.showupAddress}
            eventId={eventId}
            chainId={chainId}
          />
        ) : (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              Deposit locked — show QR at the door
            </p>
          </div>
        )}
      </div>
    );
  })() : null;

  return (
    <>
      {showScanner && (
        <QrScanner
          eventId={eventId}
          chainId={chainId}
          contractAddress={cfg.showupAddress}
          onScan={handleQrScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="pb-10">
        {/* Back + share */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--muted)' }}
          >
            <ArrowLeft className="size-4" /> All events
          </button>
          <button
            onClick={() => { void handleCopyLink(); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
          >
            {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" />}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>

        {WrongChainBanner}

        {/* Hero card */}
        <div
          className="rounded-3xl p-5 mb-4"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(18,45,69,0.08)' }}
        >
          <div className="flex items-start justify-between gap-3 mb-1">
            <h1 className="display text-2xl font-bold leading-tight" style={{ color: 'var(--ink)' }}>
              {ev.name}
            </h1>
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ color: statusColor, background: statusBg }}
            >
              {statusLabel}
            </span>
          </div>

          {/* Deposit */}
          <div className="flex items-baseline gap-1.5 mb-4">
            <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {depositFormatted}
            </span>
            <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC deposit</span>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            {([
              { label: 'Organizer',              value: shortAddr(ev.organizer) },
              { label: 'Seats',                  value: `${ev.rsvpCount} / ${ev.capacity}` },
              { label: 'RSVP closes & doors open', value: formatDate(ev.startTime) },
              { label: 'Check-in closes',          value: formatDate(ev.checkInDeadline) },
            ] as const).map(({ label, value }) => (
              <div key={label} className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--muted)', letterSpacing: '0.04em' }}>{label}</p>
                <p className="text-sm font-medium mono" style={{ color: 'var(--ink)' }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Countdown */}
          {!hasStarted && (
            <Countdown targetSec={ev.startTime} label="RSVP closes in" />
          )}
          {hasStarted && !isEnded && (
            <Countdown targetSec={ev.checkInDeadline} label="Check-in closes in" />
          )}

          {/* Payout preview */}
          {previewPayout && (
            <div className="mt-3 rounded-2xl p-3 text-center" style={{ background: 'rgba(26,128,71,0.07)' }}>
              <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--success)', letterSpacing: '0.06em' }}>PAYOUT PREVIEW</p>
              <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                If check-in closed now, each attendee would get{' '}
                <strong>{previewPayout} USDC</strong>
              </p>
            </div>
          )}
          {previewPayoutAllRefund && (
            <div className="mt-3 rounded-2xl p-3 text-center" style={{ background: 'rgba(26,128,71,0.07)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
                No check-ins yet — everyone would get a full refund.
              </p>
            </div>
          )}
        </div>

        {/* My ticket — contextual by state */}
        {MyTicketBox}

        {/* Tabs: Info | Attendees */}
        <div className="flex gap-1 mb-4 rounded-xl p-1" style={{ background: 'var(--surface-muted)' }}>
          {(['info', 'attendees'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 rounded-lg py-2 text-sm font-semibold transition-all"
              style={{
                background:  tab === t ? 'var(--surface-strong)' : 'transparent',
                color:       tab === t ? 'var(--ink)' : 'var(--muted)',
                boxShadow:   tab === t ? '0 1px 4px rgba(18,45,69,0.08)' : 'none',
              }}
            >
              {t === 'info' ? 'Info' : (
                <span className="flex items-center justify-center gap-1">
                  <Users className="size-3.5" />
                  Attendees {ev.rsvpCount > 0 ? `(${ev.rsvpCount})` : ''}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'attendees' && (
          <div className="mb-4">
            <AttendeeList
              eventId={eventId}
              fromBlock={ev.createdBlock}
              chainId={chainId}
              contractAddress={cfg.showupAddress}
              refreshKey={attendeeRefresh}
            />
          </div>
        )}

        {tab === 'info' && (
          <>
            {RsvpProgress}

            <div className="space-y-3">
              {/* RSVP button (before doors open) */}
              {!hasStarted && !userRsvped && (
                <button
                  disabled={!address || rsvpBusy || wrongChain || isFull}
                  onClick={handleRsvp}
                  className="w-full rounded-2xl py-4 text-base font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {!address         ? 'Connect wallet to RSVP'
                    : isFull        ? 'Event is full'
                    : wrongChain    ? `Switch to ${cfg.label}`
                    : rsvpBusy
                      ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="size-4 animate-spin" />
                          {isApprovePending   ? 'Approve in wallet…'
                            : isApproveConfirming ? 'Approving…'
                            : isRsvpPending   ? 'Confirm RSVP…'
                            : 'RSVPing…'}
                        </span>
                      )
                      : `RSVP — lock ${depositFormatted} USDC`}
                </button>
              )}

              {/* Cancel RSVP (before doors open) */}
              {!hasStarted && userRsvped && !userClaimed && (
                <button
                  disabled={!address || cancelBusy}
                  onClick={handleCancelRsvp}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:opacity-80 active:scale-[0.99] disabled:opacity-40"
                  style={{ background: 'var(--surface-muted)', color: 'var(--danger)', border: '1px solid rgba(186,43,76,0.2)' }}
                >
                  {cancelBusy
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Cancelling…</span>
                    : 'Cancel RSVP & get refund'}
                </button>
              )}

              {/* Claimed explorer link (just confirmed this session) */}
              {isClaimSuccess && claimTxUrl && (
                <a
                  href={claimTxUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold"
                  style={{ background: 'rgba(26,128,71,0.1)', color: 'var(--success)' }}
                >
                  <CheckCircle2 className="size-4" />
                  Claimed — view on explorer
                  <ExternalLink className="size-3.5" />
                </a>
              )}

              {/* Organizer check-in panel */}
              {isOrganizer && hasStarted && !isEnded && (
                <div
                  className="rounded-2xl p-4 space-y-3"
                  style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
                >
                  <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                    Check in attendees
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {ev.checkedInCount} / {ev.rsvpCount} checked in
                  </p>

                  <button
                    onClick={() => setShowScanner(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    <ScanLine className="size-4" /> Scan QR to check in
                  </button>

                  <div>
                    <p className="text-xs mb-1.5" style={{ color: 'var(--muted)' }}>Manual (no signature check)</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={checkInAddress}
                        onChange={(e) => setCheckInAddress(e.target.value)}
                        placeholder="0x…"
                        className="flex-1 rounded-xl px-3 py-2.5 text-sm font-medium mono outline-none"
                        style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                      />
                      <button
                        disabled={checkInBusy || !checkInAddress}
                        onClick={() => handleCheckIn()}
                        className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                        style={{ background: 'var(--accent)' }}
                      >
                        {checkInBusy ? <Loader2 className="size-4 animate-spin" /> : 'Check in'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
