import { useEffect, useState } from 'react';
import { createPublicClient, http, parseAbiItem, type Log } from 'viem';
import { arcTestnet, arc } from 'viem/chains';
import { CheckCircle2, Circle, Gift, Loader2 } from 'lucide-react';
import { shortAddr, type SupportedChainId, CHAIN_CONFIG } from '../showup-contract';

interface AttendeeRow {
  address:   `0x${string}`;
  rsvped:    boolean;
  checkedIn: boolean;
  claimed:   boolean;
}

interface Props {
  eventId:         bigint;
  /** Block the event was created at (from createdBlock in the contract struct). */
  fromBlock:       bigint;
  chainId:         SupportedChainId;
  contractAddress: `0x${string}`;
  refreshKey?:     number;
}

// Individual typed ABI events (needed for getLogs overloads)
const RSVP_ABI    = parseAbiItem('event Rsvped(uint256 indexed eventId, address indexed attendee)');
const CANCEL_ABI  = parseAbiItem('event RsvpCancelled(uint256 indexed eventId, address indexed attendee)');
const CHECKIN_ABI = parseAbiItem('event CheckedIn(uint256 indexed eventId, address indexed attendee)');
const CLAIMED_ABI = parseAbiItem('event Claimed(uint256 indexed eventId, address indexed attendee, uint256 amount)');

const CHUNK       = 10_000n;
const PARALLELISM = 4; // max concurrent chunk fetches

type PublicClient = ReturnType<typeof createPublicClient>;

// ── Typed log aliases ─────────────────────────────────────────────────────────
type RsvpLog    = Log<bigint, number, false, typeof RSVP_ABI,    false, [typeof RSVP_ABI]>;
type CancelLog  = Log<bigint, number, false, typeof CANCEL_ABI,  false, [typeof CANCEL_ABI]>;
type CheckInLog = Log<bigint, number, false, typeof CHECKIN_ABI, false, [typeof CHECKIN_ABI]>;
type ClaimedLog = Log<bigint, number, false, typeof CLAIMED_ABI, false, [typeof CLAIMED_ABI]>;

function clientForChain(chainId: SupportedChainId): PublicClient {
  const chain  = chainId === 5042 ? arc : arcTestnet;
  const cfg    = CHAIN_CONFIG[chainId];
  const rpcUrl = cfg.isTestnet
    ? 'https://rpc.testnet.arc.io'
    : 'https://rpc.mainnet.arc.io';
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/** Slice [from, to] into chunks of size CHUNK. */
function makeChunks(from: bigint, to: bigint): Array<{ from: bigint; to: bigint }> {
  const chunks: Array<{ from: bigint; to: bigint }> = [];
  let c = from;
  while (c <= to) {
    const end = c + CHUNK - 1n < to ? c + CHUNK - 1n : to;
    chunks.push({ from: c, to: end });
    c = end + 1n;
  }
  return chunks;
}

/** Run an array of async tasks with max `concurrency` in flight at once. */
async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length) as T[];
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/** Fetch all 4 event types in a single getLogs call per chunk, filtered by eventId. */
async function fetchChunk(
  client:     PublicClient,
  address:    `0x${string}`,
  eventId:    bigint,
  from:       bigint,
  to:         bigint,
): Promise<{
  rsvp:    RsvpLog[];
  cancel:  CancelLog[];
  checkIn: CheckInLog[];
  claimed: ClaimedLog[];
}> {
  // Fetch each event type in parallel within one chunk — four concurrent getLogs.
  // (We can't mix different event ABIs in one getLogs call in viem v2.)
  const [rsvp, cancel, checkIn, claimed] = await Promise.all([
    client.getLogs({ address, event: RSVP_ABI,    args: { eventId }, fromBlock: from, toBlock: to }),
    client.getLogs({ address, event: CANCEL_ABI,  args: { eventId }, fromBlock: from, toBlock: to }),
    client.getLogs({ address, event: CHECKIN_ABI, args: { eventId }, fromBlock: from, toBlock: to }),
    client.getLogs({ address, event: CLAIMED_ABI, args: { eventId }, fromBlock: from, toBlock: to }),
  ]);
  return { rsvp, cancel, checkIn, claimed };
}

function addrSet(logs: Array<{ args: { attendee?: string | null } }>): Set<string> {
  return new Set(logs.flatMap((l) => (l.args.attendee ? [l.args.attendee.toLowerCase()] : [])));
}

export function AttendeeList({
  eventId, fromBlock, chainId, contractAddress, refreshKey = 0,
}: Props) {
  const [rows,     setRows]     = useState<AttendeeRow[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);          // oxlint-disable-line react/set-state-in-effect
    setProgress('Connecting…'); // oxlint-disable-line react/set-state-in-effect

    async function load() {
      try {
        const client  = clientForChain(chainId);
        const toBlock = await client.getBlockNumber();

        // Use createdBlock if available and reasonable; otherwise fall back to
        // contract deployBlock from config (defensive, should always have createdBlock).
        const start   = fromBlock > 0n ? fromBlock : CHAIN_CONFIG[chainId].deployBlock;
        const chunks  = makeChunks(start, toBlock);
        const total   = chunks.length;

        if (alive) setProgress(`Scanning ${total} block range${total !== 1 ? 's' : ''}…`);

        // Run chunk fetches in parallel batches of PARALLELISM
        const tasks = chunks.map((ch) => () =>
          fetchChunk(client, contractAddress, eventId, ch.from, ch.to),
        );
        const results = await runConcurrent(tasks, PARALLELISM);

        // Merge all results
        const allRsvp:    RsvpLog[]    = results.flatMap((r) => r.rsvp);
        const allCancel:  CancelLog[]  = results.flatMap((r) => r.cancel);
        const allCheckIn: CheckInLog[] = results.flatMap((r) => r.checkIn);
        const allClaimed: ClaimedLog[] = results.flatMap((r) => r.claimed);

        const cancelledSet  = addrSet(allCancel);
        const checkedInSet  = addrSet(allCheckIn);
        const claimedSet    = addrSet(allClaimed);

        const rowMap = new Map<string, AttendeeRow>();
        for (const log of allRsvp) {
          const addr = log.args.attendee;
          if (!addr || typeof addr !== 'string') continue;
          const lower = addr.toLowerCase();
          if (!cancelledSet.has(lower)) {
            rowMap.set(lower, {
              address:   addr,
              rsvped:    true,
              checkedIn: checkedInSet.has(lower),
              claimed:   claimedSet.has(lower),
            });
          }
        }

        if (alive) { setProgress(null); setRows([...rowMap.values()]); }
      } catch {
        if (alive) { setProgress(null); setRows([]); }
      }
    }

    void load();
    return () => { alive = false; };
  }, [eventId, fromBlock, chainId, contractAddress, refreshKey]);

  const loading = rows === null;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-5">
        <Loader2 className="size-4 animate-spin shrink-0" style={{ color: 'var(--accent-hover)' }} />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {progress ?? 'Loading attendees…'}
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs py-4 text-center" style={{ color: 'var(--muted)' }}>
        No RSVPs yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.address}
          className="flex items-center justify-between rounded-xl px-3 py-2.5"
          style={{ background: 'var(--surface-muted)' }}
        >
          <span className="mono text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
            {shortAddr(row.address)}
          </span>
          <span className="flex items-center gap-1 text-xs font-semibold">
            {row.claimed ? (
              <>
                <Gift         className="size-3.5" style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--success)' }}>Claimed</span>
              </>
            ) : row.checkedIn ? (
              <>
                <CheckCircle2 className="size-3.5" style={{ color: 'var(--accent-hover)' }} />
                <span style={{ color: 'var(--accent-hover)' }}>Checked in</span>
              </>
            ) : (
              <>
                <Circle className="size-3.5" style={{ color: 'var(--muted)' }} />
                <span style={{ color: 'var(--muted)' }}>RSVPed</span>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
