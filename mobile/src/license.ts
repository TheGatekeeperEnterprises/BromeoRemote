import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Ported from client/src/main/main.ts's verifyClientLicense/getClientHwid —
// mobile has no main/renderer split and no IPC, so this is the same logic
// as plain exported functions instead of IPC handlers, and AsyncStorage
// instead of the desktop's JSON config store.

// Same key App.tsx already uses for its persisted BromeoRemote peer ID
// (see DEVICE_ID_KEY there) — deliberately reused rather than duplicated,
// since a stable per-install random ID is exactly what HWID binding needs
// and there's no react-native-device-info package installed for a real
// hardware fingerprint (adding one means a native rebuild).
const DEVICE_ID_KEY = "bromeoremote_device_id";

const LICENSE_KEY_KEY = "bromeoremote_license_key";
const LICENSE_EMAIL_KEY = "bromeoremote_license_email";
const LICENSE_STATUS_KEY = "bromeoremote_license_status";

// Purely informational (goes into session_events.app_version for analytics,
// not used for any gating) — bump alongside versionCode in
// android/app/build.gradle when cutting a new release.
const APP_VERSION = "0.0.16";

export interface LicenseFeatures {
  sessionLimitMinutes: number | null;
  allowFileTransfer: boolean;
  allowAiBuddy: boolean;
}

export interface LicenseStatus {
  valid: boolean;
  reason?: string;
  plan?: string;
  status?: string;
  isTrial?: boolean;
  expiresAt?: string | null;
  userEmail?: string;
  features?: LicenseFeatures;
}

export interface LicenseInfo {
  licenseKey: string | null;
  licenseEmail: string | null;
  licenseStatus: LicenseStatus | null;
  hwid: string;
}

async function getOrCreateHwid(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    // Extremely unlikely in practice — App.tsx's own startup effect creates
    // this before the user could ever reach the license settings — but
    // fall back to generating one here too rather than sending an empty
    // HWID if it's somehow not there yet.
    id = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function getLicenseStatus(): Promise<LicenseInfo> {
  const [licenseKey, licenseEmail, statusRaw, hwid] = await Promise.all([
    AsyncStorage.getItem(LICENSE_KEY_KEY),
    AsyncStorage.getItem(LICENSE_EMAIL_KEY),
    AsyncStorage.getItem(LICENSE_STATUS_KEY),
    getOrCreateHwid(),
  ]);
  let licenseStatus: LicenseStatus | null = null;
  if (statusRaw) {
    try {
      licenseStatus = JSON.parse(statusRaw);
    } catch {
      licenseStatus = null;
    }
  }
  return { licenseKey, licenseEmail, licenseStatus, hwid };
}

async function setLicenseInfo(key: string | null, email: string | null, status: LicenseStatus): Promise<void> {
  await Promise.all([
    key ? AsyncStorage.setItem(LICENSE_KEY_KEY, key) : AsyncStorage.removeItem(LICENSE_KEY_KEY),
    email ? AsyncStorage.setItem(LICENSE_EMAIL_KEY, email) : AsyncStorage.removeItem(LICENSE_EMAIL_KEY),
    AsyncStorage.setItem(LICENSE_STATUS_KEY, JSON.stringify(status)),
  ]);
}

export async function verifyMobileLicense(licenseKey?: string, email?: string): Promise<LicenseStatus> {
  try {
    const hwid = await getOrCreateHwid();
    const cachedInfo = await getLicenseStatus();
    const key = licenseKey !== undefined ? licenseKey.trim() : cachedInfo.licenseKey || "";
    const mail = email !== undefined ? email.trim() : cachedInfo.licenseEmail || "";

    if (!key && !mail) {
      const res: LicenseStatus = { valid: false, reason: "Geen licentie of e-mail ingevoerd." };
      await setLicenseInfo(null, null, res);
      return res;
    }

    const response = await fetch("https://bromeoremote.com/api/license/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: key,
        email: mail,
        hwid,
        platform: Platform.OS,
        appVersion: APP_VERSION,
      }),
    });

    const data = await response.json();
    if (data.valid) {
      await setLicenseInfo(key || null, mail || null, data);
      return data;
    }
    const invalid: LicenseStatus = { valid: false, reason: data.reason };
    await setLicenseInfo(key || null, mail || null, invalid);
    return { valid: false, reason: data.reason || "Ongeldige licentie." };
  } catch (err: any) {
    const cached = (await getLicenseStatus()).licenseStatus;
    if (cached && cached.valid) return cached;
    return { valid: false, reason: "Kan licentieserver niet bereiken: " + (err?.message || err) };
  }
}
