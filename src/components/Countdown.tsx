import { useState, useEffect } from 'react';

interface Props {
  /** Unix timestamp (seconds) to count down to */
  targetSec: bigint;
  label: string;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function Countdown({ targetSec, label }: Props) {
  const [diff, setDiff] = useState(
    () => Math.max(0, Number(targetSec) - Math.floor(Date.now() / 1000)),
  );

  useEffect(() => {
    const id = setInterval(() => {
      const d = Math.max(0, Number(targetSec) - Math.floor(Date.now() / 1000));
      setDiff(d);
    }, 1000);
    return () => clearInterval(id);
  }, [targetSec]);

  if (diff === 0) return null;

  const days = Math.floor(diff / 86400);
  const hrs = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;

  return (
    <div className="rounded-2xl p-3 text-center" style={{ background: 'rgba(16,97,166,0.07)' }}>
      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--accent-hover)', letterSpacing: '0.06em' }}>
        {label.toUpperCase()}
      </p>
      <p className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
        {days > 0
          ? `${days}d ${pad(hrs)}h ${pad(mins)}m`
          : `${pad(hrs)}:${pad(mins)}:${pad(secs)}`}
      </p>
    </div>
  );
}
