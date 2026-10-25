import artifact from '../contracts/out/ShowUp.sol/ShowUp.json';

// ---------------------------------------------------------------------------
// Chain config — add mainnet address here when ready
// ---------------------------------------------------------------------------
export const CHAIN_CONFIG = {
  // Arc Testnet
  5042002: {
    chainId: 5042002 as const,
    label: 'Arc Testnet',
    showupAddress: '0xde1d55d2fffd968f77f32a1b2450f437c382545a' as `0x${string}`,
    usdcAddress: '0x3600000000000000000000000000000000000000' as `0x${string}`,
    usdcDecimals: 6,
    explorerBase: 'https://explorer.testnet.arc.io',
    isTestnet: true,
    /** Block at which ShowUp v2 (createdBlock) was deployed — log scans start here. */
    deployBlock: 69053559n,
  },
  // Arc Mainnet
  5042: {
    chainId: 5042 as const,
    label: 'Arc',
    showupAddress: '0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C' as `0x${string}`,
    usdcAddress: '0x3600000000000000000000000000000000000000' as `0x${string}`,
    usdcDecimals: 6,
    explorerBase: 'https://explorer.arc.io',
    isTestnet: false,
    /** Block at which ShowUp was deployed on Arc mainnet. */
    deployBlock: 27825276n,
  },
} as const;

export type SupportedChainId = keyof typeof CHAIN_CONFIG;

export const SUPPORTED_CHAIN_IDS = Object.keys(CHAIN_CONFIG).map(Number) as SupportedChainId[];

export const DEFAULT_CHAIN_ID: SupportedChainId = 5042;

export function getChainConfig(chainId: number) {
  return CHAIN_CONFIG[chainId as SupportedChainId] ?? null;
}

// ---------------------------------------------------------------------------
// ABI
// ---------------------------------------------------------------------------
export const SHOWUP_ABI = artifact.abi;

export function showupContract(chainId: SupportedChainId) {
  const cfg = CHAIN_CONFIG[chainId];
  return { address: cfg.showupAddress, abi: SHOWUP_ABI } as const;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export interface ShowUpEvent {
  name: string;
  organizer: `0x${string}`;
  deposit: bigint;
  capacity: number;
  startTime: bigint;
  checkInDeadline: bigint;
  rsvpCount: number;
  checkedInCount: number;
  claimedCount: number;
  createdBlock: bigint;
}

/** Coerce wagmi's typed-struct result (often `{}` from TypeScript's perspective) to ShowUpEvent. */
export function coerceEvent(raw: unknown): ShowUpEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r['name'] !== 'string' ||
    typeof r['organizer'] !== 'string' ||
    typeof r['deposit'] !== 'bigint' ||
    typeof r['startTime'] !== 'bigint' ||
    typeof r['checkInDeadline'] !== 'bigint'
  ) {
    return null;
  }
  return {
    name: r['name'],
    organizer: r['organizer'] as `0x${string}`,
    deposit: r['deposit'],
    capacity: Number(r['capacity'] ?? 0),
    startTime: r['startTime'],
    checkInDeadline: r['checkInDeadline'],
    rsvpCount: Number(r['rsvpCount'] ?? 0),
    checkedInCount: Number(r['checkedInCount'] ?? 0),
    claimedCount: Number(r['claimedCount'] ?? 0),
    createdBlock: typeof r['createdBlock'] === 'bigint' ? r['createdBlock'] : 0n,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export function formatUsdc6(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

export function shortAddr(a: string): string {
  if (a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
