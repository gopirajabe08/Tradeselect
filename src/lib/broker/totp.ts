// RFC 6238 TOTP generator. Pure Node, no new dependencies.
// Used for TradeJini Individual-mode auth (twoFa code).

import crypto from "crypto";

/**
 * Decode base32 (RFC 4648) into bytes. TOTP secrets are usually base32.
 * Handles upper/lower case, ignores `=` padding and whitespace.
 */
function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, "").replace(/\s/g, "").toUpperCase();
  const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = ALPH.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Generate a 6-digit TOTP code for the given base32 secret.
 * Default 30-second window, SHA-1 (TradeJini standard).
 */
export function totp(secret: string, atMs: number = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  // Counter is big-endian 64-bit; JS bitwise ops are 32-bit so split carefully.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = (bin % 1_000_000).toString().padStart(6, "0");
  return code;
}
