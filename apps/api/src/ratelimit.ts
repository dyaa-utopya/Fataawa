interface Bucket {
  tokens: number;
  last: number;
}

/**
 * Token bucket par clé (IP), en mémoire d'instance. Suffisant pour un front
 * public sans login : combiné à `max-instances` bas côté Cloud Run, il borne
 * le débit global. (Durcissement possible plus tard : App Check + Firestore.)
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastPrune = 0;

  constructor(
    private readonly ratePerMinute: number,
    private readonly burst: number = ratePerMinute,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    this.pruneIfNeeded(now);
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, last: now };
    const refill = ((now - bucket.last) / 60_000) * this.ratePerMinute;
    bucket.tokens = Math.min(this.burst, bucket.tokens + refill);
    bucket.last = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  private pruneIfNeeded(now: number): void {
    if (now - this.lastPrune < 300_000) return;
    this.lastPrune = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last > 600_000) this.buckets.delete(key);
    }
  }
}
