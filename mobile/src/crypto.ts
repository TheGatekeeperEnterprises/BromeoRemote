import { sha256 } from "js-sha256";

// Hermes has no Web Crypto API, so we use a small pure-JS SHA-256
// implementation instead of native crypto bindings — this is only ever
// hashing a password before it leaves the device, not a performance path.
export async function sha256Hex(text: string): Promise<string> {
  return sha256(text);
}
