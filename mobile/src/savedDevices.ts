import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SavedDevice } from "./shared/protocol";

const STORAGE_KEY = "bromeoremote_saved_devices";

// Stores only the already-hashed session password (SavedDevice.passwordHash),
// never the plaintext — the wire protocol itself only ever carries the hash
// (see ClientMessage's connect-request), so one-tap reconnect just resends
// that same stored hash and never needs the plaintext back.
export async function getSavedDevices(): Promise<SavedDevice[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedDevice[]) : [];
  } catch {
    return [];
  }
}

async function setSavedDevices(devices: SavedDevice[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}

export async function saveDevice(device: SavedDevice): Promise<SavedDevice[]> {
  const devices = await getSavedDevices();
  const existing = devices.findIndex((d) => d.id === device.id);
  if (existing >= 0) devices[existing] = { ...devices[existing], ...device };
  else devices.push(device);
  await setSavedDevices(devices);
  return devices;
}

export async function removeSavedDevice(id: string): Promise<SavedDevice[]> {
  const devices = (await getSavedDevices()).filter((d) => d.id !== id);
  await setSavedDevices(devices);
  return devices;
}

export async function toggleFavorite(id: string): Promise<SavedDevice[]> {
  const devices = await getSavedDevices();
  const device = devices.find((d) => d.id === id);
  if (device) device.favorite = !device.favorite;
  await setSavedDevices(devices);
  return devices;
}

// Favorites first, then alphabetical by label — matches the desktop
// address book's sort order (see docs/ROADMAP.md).
export function sortSavedDevices(devices: SavedDevice[]): SavedDevice[] {
  return [...devices].sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}
