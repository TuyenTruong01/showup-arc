import { useEffect, useState } from 'react';

/**
 * Returns the current Unix timestamp in seconds as a bigint, updating every second.
 * Shared across the app so status labels, buttons, and countdowns all tick together.
 */
export function useClock(): bigint {
  const [nowSec, setNowSec] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const id = setInterval(() => {
      setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return nowSec;
}
