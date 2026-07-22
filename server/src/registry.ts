import type { WebSocket } from "ws";

// In-memory ID registry — equivalent to RustDesk's hbbs peer map.
// A device's BromeoRemote-ID is only ever "online" for the lifetime of its
// WebSocket connection; nothing is persisted server-side.
export class DeviceRegistry {
  private idToSocket = new Map<string, WebSocket>();
  private socketToId = new Map<WebSocket, string>();

  private randomId(): string {
    // 9-digit numeric ID, no leading zero (matches the familiar TeamViewer-style ID format).
    const first = 1 + Math.floor(Math.random() * 9);
    let rest = "";
    for (let i = 0; i < 8; i++) rest += Math.floor(Math.random() * 10);
    return `${first}${rest}`;
  }

  register(socket: WebSocket, requestedId?: string): string {
    if (requestedId) {
      // A device reconnecting with its own persisted ID should always
      // reclaim it — if another (necessarily stale/dead, since a live
      // device can't have two sockets) socket is squatting on it, close
      // that one out rather than silently handing the requester a
      // different random ID. Without a ping/pong heartbeat, a force-killed
      // app's socket can otherwise sit in the registry for a long time
      // after it's actually gone.
      const stale = this.idToSocket.get(requestedId);
      if (stale && stale !== socket) {
        this.socketToId.delete(stale);
        stale.close();
      }
      this.idToSocket.set(requestedId, socket);
      this.socketToId.set(socket, requestedId);
      return requestedId;
    }
    let id = this.randomId();
    while (this.idToSocket.has(id)) id = this.randomId();
    this.idToSocket.set(id, socket);
    this.socketToId.set(socket, id);
    return id;
  }

  get(id: string): WebSocket | undefined {
    return this.idToSocket.get(id);
  }

  idFor(socket: WebSocket): string | undefined {
    return this.socketToId.get(socket);
  }

  remove(socket: WebSocket): string | undefined {
    const id = this.socketToId.get(socket);
    if (id) {
      this.idToSocket.delete(id);
      this.socketToId.delete(socket);
    }
    return id;
  }

  get onlineCount(): number {
    return this.idToSocket.size;
  }
}
