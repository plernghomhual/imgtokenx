/** Constant-time string compare (pure JS — this module is runtime-agnostic,
 *  so no node:crypto.timingSafeEqual and no async crypto.subtle like
 *  secretsMatch). XOR-folds over the presented value's full length; only the
 *  expected value's length is observable, and that isn't secret material. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const bLen = Math.max(b.length, 1);
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i % bLen);
  }
  return diff === 0;
}

/** Compare SHA-256 digests instead of the raw strings so the comparison
 *  can't leak a prefix-match timing signal. */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= (va[i] ?? 0) ^ (vb[i] ?? 0);
  return diff === 0;
}
