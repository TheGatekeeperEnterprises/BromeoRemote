import type { ClientMessage, ServerMessage } from "./shared/protocol";

type Listener = (msg: ServerMessage) => void;
type StatusListener = (status: "connected" | "disconnected") => void;

export class Signaling {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private queue: ClientMessage[] = [];
  // Distinguishes a deliberate close() from the connection just dropping
  // (server restart, network blip) — only the latter should trigger
  // reconnect attempts. Without this, any WebSocket close (including ones
  // this app itself asked for) permanently gave up until the app restarted.
  private intentionallyClosed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1000;

  constructor(private url: string) {}

  connect(): Promise<void> {
    this.intentionallyClosed = false;
    return this.attemptConnect();
  }

  private attemptConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectDelayMs = 1000; // reset backoff once a connection actually succeeds
        for (const msg of this.queue.splice(0)) ws.send(JSON.stringify(msg));
        for (const l of this.statusListeners) l("connected");
        resolve();
      };
      ws.onerror = () => reject(new Error("Kan geen verbinding maken met de BromeoRemote-server."));
      ws.onclose = () => {
        this.ws = null;
        for (const l of this.statusListeners) l("disconnected");
        if (!this.intentionallyClosed) this.scheduleReconnect();
      };
      ws.onmessage = (ev) => {
        try {
          const msg: ServerMessage = JSON.parse(ev.data);
          for (const l of this.listeners) l(msg);
        } catch {
          // ignore malformed frames
        }
      };
    });
  }

  // Exponential backoff (1s, 2s, 4s... capped at 15s) rather than a fixed
  // interval, so a brief blip recovers fast without hammering the server
  // during a longer outage.
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptConnect().catch(() => {
        // attemptConnect's own onclose handler already schedules the next
        // retry — this catch just prevents an unhandled rejection.
      });
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15_000);
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Fires "connected" on the initial connect *and* every successful
  // reconnect — callers that need to re-register something with the server
  // (e.g. this device's ID via a "hello" message) should do it here rather
  // than only once after the first connect().
  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
