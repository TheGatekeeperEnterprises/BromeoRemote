import { createHmac, randomBytes } from "crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30s step) — compatible with Google
// Authenticator, Authy, etc. No external dependency: HMAC-SHA1 comes
// straight from Node's crypto module.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function generateTotp(base32Secret: string, atTimeMs: number = Date.now()): string {
  const counter = Math.floor(atTimeMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(base32Secret), counter);
}

/** Accepts the current 30s window plus one step of clock drift on either side. */
export function verifyTotp(base32Secret: string, code: string, driftSteps = 1): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const now = Date.now();
  for (let d = -driftSteps; d <= driftSteps; d++) {
    if (generateTotp(base32Secret, now + d * STEP_SECONDS * 1000) === trimmed) return true;
  }
  return false;
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildOtpauthUri(secret: string, deviceId: string): string {
  return `otpauth://totp/BromeoRemote:${deviceId}?secret=${secret}&issuer=BromeoRemote&digits=6&period=${STEP_SECONDS}`;
}
