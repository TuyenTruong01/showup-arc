import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';

function dateMinString(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 16);
}
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi';
import { toast } from 'sonner';
import {
  showupContract,
  CHAIN_CONFIG,
  DEFAULT_CHAIN_ID,
  type SupportedChainId,
} from '../showup-contract';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  chainId?: SupportedChainId;
}

const springs = {
  sheet: { type: 'spring' as const, stiffness: 400, damping: 40 },
};

export function CreateEventSheet({
  open,
  onClose,
  onCreated,
  chainId = DEFAULT_CHAIN_ID,
}: Props) {
  const cfg = CHAIN_CONFIG[chainId];
  const CONTRACT = showupContract(chainId);

  const { address, chainId: walletChain } = useAccount();
  const { switchChain } = useSwitchChain();
  const wrongChain = walletChain !== chainId;

  const [name, setName] = useState('');
  const [deposit, setDeposit] = useState('');
  const [capacity, setCapacity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (isSuccess) {
    toast.success('Event created!');
    onCreated();
    onClose();
    reset();
    setName(''); setDeposit(''); setCapacity(''); setStartDate(''); setDeadlineDate('');
  }

  function handleCreate() {
    if (!name.trim()) { toast.error('Enter an event name.'); return; }
    const depositNum = parseFloat(deposit);
    if (!deposit || isNaN(depositNum) || depositNum <= 0) { toast.error('Enter a valid deposit amount.'); return; }
    const cap = parseInt(capacity, 10);
    if (!capacity || isNaN(cap) || cap <= 0) { toast.error('Enter a valid capacity.'); return; }
    if (!startDate) { toast.error('Set a start date.'); return; }
    if (!deadlineDate) { toast.error('Set a check-in deadline.'); return; }

    const startTs = BigInt(Math.floor(new Date(startDate).getTime() / 1000));
    const deadlineTs = BigInt(Math.floor(new Date(deadlineDate).getTime() / 1000));
    const nowTs = BigInt(Math.floor(Date.now() / 1000));

    if (startTs <= nowTs) { toast.error('Start time must be in the future.'); return; }
    if (deadlineTs <= startTs) { toast.error('Check-in deadline must be after start time.'); return; }

    // Convert deposit to USDC micro-units (6 decimals)
    const depositRaw = BigInt(Math.round(depositNum * 1_000_000));

    if (wrongChain) { switchChain({ chainId }); return; }

    writeContract({
      ...CONTRACT,
      functionName: 'createEvent',
      args: [name.trim(), depositRaw, cap, Number(startTs), Number(deadlineTs)],
    });
  }

  const busy = isPending || isConfirming;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-md overflow-hidden rounded-t-3xl"
            style={{
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springs.sheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1 rounded-full" style={{ background: 'linear-gradient(90deg,#acc6e9,#85b1ed,#acc6e9)' }} />
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/10" />
            </div>

            <div className="px-5 pb-8 pt-2">
              <div className="flex items-center justify-between mb-5">
                <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
                  Create event
                </h2>
                <button onClick={onClose} className="p-1 rounded-lg transition-opacity hover:opacity-60">
                  <X className="size-5" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              <div className="space-y-4">
                <Field label="Event name">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Monthly Web3 Builders meetup"
                    className="w-full rounded-xl px-3.5 py-3 text-sm outline-none"
                    style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Deposit (USDC on ${cfg.label})`}>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={deposit}
                      onChange={(e) => setDeposit(e.target.value)}
                      placeholder="5"
                      min="0"
                      step="0.01"
                      className="w-full rounded-xl px-3.5 py-3 text-sm outline-none"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                    />
                  </Field>
                  <Field label="Max seats">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={capacity}
                      onChange={(e) => setCapacity(e.target.value)}
                      placeholder="50"
                      min="1"
                      className="w-full rounded-xl px-3.5 py-3 text-sm outline-none"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                    />
                  </Field>
                </div>

                <Field label="RSVP closes & doors open">
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={dateMinString(5 * 60 * 1000)}
                    className="w-full rounded-xl px-3.5 py-3 text-sm outline-none"
                    style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                  />
                </Field>

                <Field label="Check-in closes">
                  <input
                    type="datetime-local"
                    value={deadlineDate}
                    onChange={(e) => setDeadlineDate(e.target.value)}
                    min={startDate || dateMinString(15 * 60 * 1000)}
                    className="w-full rounded-xl px-3.5 py-3 text-sm outline-none"
                    style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                  />
                </Field>
              </div>

              <button
                disabled={!address || busy}
                onClick={handleCreate}
                className="mt-6 w-full rounded-2xl py-4 text-base font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {!address ? 'Connect wallet first'
                  : busy
                    ? <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        {isPending ? 'Confirm in wallet…' : 'Creating…'}
                      </span>
                    : 'Create event'}
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)', letterSpacing: '0.04em' }}>
        {label.toUpperCase()}
      </label>
      {children}
    </div>
  );
}
