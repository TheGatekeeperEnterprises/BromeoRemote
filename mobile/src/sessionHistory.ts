import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "bromeoremote_session_history";
const MAX_ENTRIES = 25; // matches client/src/renderer/app.ts's own cap

export interface SessionHistoryEntry {
  id: string;
  peerId: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  filesTransferred: number;
}

export async function getSessionHistory(): Promise<SessionHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

async function setSessionHistory(history: SessionHistoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
}

export async function addSessionHistoryEntry(entry: SessionHistoryEntry): Promise<SessionHistoryEntry[]> {
  const history = await getSessionHistory();
  history.unshift(entry);
  const capped = history.slice(0, MAX_ENTRIES);
  await setSessionHistory(capped);
  return capped;
}

export async function clearSessionHistory(): Promise<SessionHistoryEntry[]> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  return [];
}
