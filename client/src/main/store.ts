import { app, safeStorage } from "electron";
import { createHash, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { hostname } from "os";
import type { SavedDevice } from "../shared/protocol";

export type { SavedDevice };

export interface StoreData {
  deviceId: string;
  deviceLabel: string;
  unattendedEnabled: boolean;
  unattendedPasswordHash: string | null;
  theme: "dark" | "light";
  notifyForwardId: string | null;
  curtainModeEnabled: boolean;
  totpEnabled: boolean;
  // Encrypted (via Electron safeStorage / OS keychain) base64 blob of SavedDevice[].
  // Never store saved-device password hashes as plaintext on disk.
  savedDevicesEncrypted: string | null;
  // Encrypted base32 TOTP secret — a live ongoing credential, same trust
  // level as an actual password, so it gets the same safeStorage treatment.
  totpSecretEncrypted: string | null;
  // Encrypted OpenAI API key for "AI Buddy" — a billable credential, same
  // safeStorage treatment as the TOTP secret above.
  openaiApiKeyEncrypted: string | null;
  // Devices that skip the TOTP prompt for unattended access until
  // trustedUntil (ms epoch) — opted into per-device at the moment a 2FA
  // code is verified (see "trustDevice" in the connect-request protocol),
  // never automatic. Not secret data (just a device id + label + a
  // timestamp — device ids already travel in plaintext over signaling), so
  // unlike savedDevices/totpSecret this isn't safeStorage-encrypted.
  trustedDevices: { id: string; label: string; trustedUntil: number }[];
  licenseKey: string | null;
  licenseEmail: string | null;
  licenseStatus: { valid: boolean; plan?: string; expiresAt?: string | null; reason?: string } | null;
}

function randomDeviceId(): string {
  const first = 1 + Math.floor(Math.random() * 9);
  let rest = "";
  for (let i = 0; i < 8; i++) rest += Math.floor(Math.random() * 10);
  return `${first}${rest}`;
}

export function hashPassword(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex");
}

export function randomPassword(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

class Store {
  private path: string;
  private data: StoreData;
  private isSecondary = false;

  constructor() {
    this.path = join(app.getPath("userData"), "bromeoremote-config.json");
    this.data = this.load();
  }

  setSecondaryInstance(): void {
    this.isSecondary = true;
    // Generate a fresh, unique device ID for this secondary instance so it doesn't collide on the server
    this.data = {
      ...this.data,
      deviceId: randomDeviceId(),
      deviceLabel: `${hostname()} (Instantie 2)`,
    };
  }

  private load(): StoreData {
    if (existsSync(this.path)) {
      try {
        const raw = JSON.parse(readFileSync(this.path, "utf8"));
        return {
          deviceId: raw.deviceId ?? randomDeviceId(),
          deviceLabel: raw.deviceLabel ?? hostname(),
          unattendedEnabled: !!raw.unattendedEnabled,
          unattendedPasswordHash: raw.unattendedPasswordHash ?? null,
          theme: raw.theme === "dark" ? "dark" : "light",
          notifyForwardId: raw.notifyForwardId ?? null,
          curtainModeEnabled: !!raw.curtainModeEnabled,
          totpEnabled: !!raw.totpEnabled,
          savedDevicesEncrypted: raw.savedDevicesEncrypted ?? null,
          totpSecretEncrypted: raw.totpSecretEncrypted ?? null,
          openaiApiKeyEncrypted: raw.openaiApiKeyEncrypted ?? null,
          trustedDevices: Array.isArray(raw.trustedDevices) ? raw.trustedDevices : [],
          licenseKey: raw.licenseKey ?? null,
          licenseEmail: raw.licenseEmail ?? null,
          licenseStatus: raw.licenseStatus ?? null,
        };
      } catch {
        // fall through to defaults on corrupt file
      }
    }
    return {
      deviceId: randomDeviceId(),
      deviceLabel: hostname(),
      unattendedEnabled: false,
      unattendedPasswordHash: null,
      theme: "light",
      notifyForwardId: null,
      curtainModeEnabled: false,
      totpEnabled: false,
      savedDevicesEncrypted: null,
      totpSecretEncrypted: null,
      openaiApiKeyEncrypted: null,
      trustedDevices: [],
      licenseKey: null,
      licenseEmail: null,
      licenseStatus: null,
    };
  }

  save(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf8");
  }

  get(): StoreData {
    return { ...this.data };
  }

  update(partial: Partial<StoreData>): StoreData {
    this.data = { ...this.data, ...partial };
    this.save();
    return this.get();
  }

  setLicenseInfo(key: string | null, email: string | null, status: any): void {
    this.data.licenseKey = key;
    this.data.licenseEmail = email;
    this.data.licenseStatus = status;
    this.save();
  }

  // Saved devices are decrypted lazily (never in the constructor): safeStorage
  // requires the app to be 'ready', which hasn't happened yet when this
  // module-level singleton is first constructed.
  private savedDevicesCache: SavedDevice[] | null = null;

  getSavedDevices(): SavedDevice[] {
    if (this.savedDevicesCache) return [...this.savedDevicesCache];
    let devices: SavedDevice[] = [];
    if (this.data.savedDevicesEncrypted) {
      try {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("encryption unavailable");
        const decrypted = safeStorage.decryptString(Buffer.from(this.data.savedDevicesEncrypted, "base64"));
        devices = JSON.parse(decrypted);
      } catch {
        // Can't decrypt (different machine/OS account, or encryption unavailable) — start empty rather than crash.
        devices = [];
      }
    }
    this.savedDevicesCache = devices;
    return [...devices];
  }

  setSavedDevices(devices: SavedDevice[]): void {
    this.savedDevicesCache = devices;
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(JSON.stringify(devices));
      this.update({ savedDevicesEncrypted: encrypted.toString("base64") });
    }
  }

  // 30 days — long enough to actually save the prompt across normal repeat
  // use, short enough that a lost/stolen device's bypass expires on its own
  // without needing to be manually revoked.
  private static readonly TRUST_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

  getTrustedDevices(): { id: string; label: string; trustedUntil: number }[] {
    const now = Date.now();
    const fresh = this.data.trustedDevices.filter((d) => d.trustedUntil > now);
    if (fresh.length !== this.data.trustedDevices.length) this.update({ trustedDevices: fresh });
    return [...fresh];
  }

  isDeviceTrusted(id: string): boolean {
    return this.getTrustedDevices().some((d) => d.id === id);
  }

  trustDevice(id: string, label: string): void {
    const trustedUntil = Date.now() + Store.TRUST_DURATION_MS;
    const existing = this.getTrustedDevices().filter((d) => d.id !== id);
    this.update({ trustedDevices: [...existing, { id, label, trustedUntil }] });
  }

  removeTrustedDevice(id: string): void {
    this.update({ trustedDevices: this.data.trustedDevices.filter((d) => d.id !== id) });
  }

  private totpSecretCache: string | null | undefined; // undefined = not loaded yet, null = none set

  getTotpSecret(): string | null {
    if (this.totpSecretCache !== undefined) return this.totpSecretCache;
    let secret: string | null = null;
    if (this.data.totpSecretEncrypted) {
      try {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("encryption unavailable");
        secret = safeStorage.decryptString(Buffer.from(this.data.totpSecretEncrypted, "base64"));
      } catch {
        secret = null;
      }
    }
    this.totpSecretCache = secret;
    return secret;
  }

  setTotpSecret(secret: string | null): void {
    this.totpSecretCache = secret;
    if (secret === null) {
      this.update({ totpSecretEncrypted: null, totpEnabled: false });
      return;
    }
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(secret);
      this.update({ totpSecretEncrypted: encrypted.toString("base64") });
    }
  }

  private openaiApiKeyCache: string | null | undefined; // undefined = not loaded yet, null = none set

  getOpenAiApiKey(): string | null {
    if (this.openaiApiKeyCache !== undefined) return this.openaiApiKeyCache;
    let key: string | null = null;
    if (this.data.openaiApiKeyEncrypted) {
      try {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("encryption unavailable");
        key = safeStorage.decryptString(Buffer.from(this.data.openaiApiKeyEncrypted, "base64"));
      } catch {
        key = null;
      }
    }
    this.openaiApiKeyCache = key;
    return key;
  }

  setOpenAiApiKey(key: string | null): void {
    this.openaiApiKeyCache = key;
    if (key === null) {
      this.update({ openaiApiKeyEncrypted: null });
      return;
    }
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      this.update({ openaiApiKeyEncrypted: encrypted.toString("base64") });
    }
  }
}

export const store = new Store();
