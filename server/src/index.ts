import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { DeviceRegistry } from "./registry";
import { RateLimiter } from "./rateLimiter";
import { setPushToken, getPushToken } from "./pushTokens";
import { sendPushNotification } from "./push";
import type { ClientMessage, ServerMessage } from "./types";

const PORT = Number(process.env.PORT ?? 21116);

const registry = new DeviceRegistry();
const connectLimiter = new RateLimiter(10, 60_000); // max 10 connect-requests/min per source id

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", online: registry.onlineCount }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

wss.on("connection", (socket: WebSocket) => {
  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Ongeldig bericht (geen geldige JSON)." });
      return;
    }

    switch (msg.type) {
      case "hello": {
        const id = registry.register(socket, msg.id);
        console.log(`[hello] registered id=${id}`);
        send(socket, { type: "welcome", id });
        break;
      }

      case "connect-request": {
        const selfId = registry.idFor(socket);
        console.log(`[connect-request] from=${selfId ?? "?"} target=${msg.targetId}`);
        if (!selfId) {
          send(socket, { type: "error", message: "Registreer eerst (hello) voordat je verbindt." });
          return;
        }
        if (!connectLimiter.allow(selfId)) {
          console.log(`[connect-request] rate-limited from=${selfId}`);
          send(socket, { type: "error", message: "Te veel verbindingspogingen. Probeer straks opnieuw." });
          return;
        }
        const target = registry.get(msg.targetId);
        if (!target) {
          console.log(`[connect-request] target=${msg.targetId} not found in registry`);
          send(socket, { type: "connect-response", fromId: msg.targetId, accept: false, reason: "offline" });
          return;
        }
        console.log(`[connect-request] forwarding incoming-request to target=${msg.targetId}`);
        send(target, {
          type: "incoming-request",
          fromId: selfId,
          fromLabel: msg.fromLabel,
          passwordHash: msg.passwordHash,
          viewOnly: msg.viewOnly,
          permissions: msg.permissions,
          totpCode: msg.totpCode,
        });
        break;
      }

      case "connect-response": {
        const selfId = registry.idFor(socket);
        console.log(`[connect-response] from=${selfId ?? "?"} target=${msg.targetId} accept=${msg.accept}`);
        if (!selfId) return;
        const target = registry.get(msg.targetId);
        if (!target) {
          console.log(`[connect-response] target=${msg.targetId} not found in registry`);
          return;
        }
        send(target, { type: "connect-response", fromId: selfId, accept: msg.accept, reason: msg.reason });
        break;
      }

      case "signal": {
        const selfId = registry.idFor(socket);
        if (!selfId) return;
        const target = registry.get(msg.targetId);
        const kind = "sdp" in (msg.payload as object) ? "sdp" : "candidate" in (msg.payload as object) ? "candidate" : "?";
        console.log(`[signal] from=${selfId} target=${msg.targetId} kind=${kind} targetOnline=${!!target}`);
        if (!target) {
          send(socket, { type: "error", message: "Partner is niet meer online." });
          return;
        }
        send(target, { type: "signal", fromId: selfId, payload: msg.payload });
        break;
      }

      case "notify": {
        const selfId = registry.idFor(socket);
        if (!selfId) return;
        const target = registry.get(msg.targetId);
        // Always try both channels rather than choosing one: the WebSocket
        // may look "connected" for a while after the OS backgrounds the app,
        // and push may lag behind actual delivery — sending both is what
        // makes a confirm request reliably reach a phone that's asleep.
        if (target) send(target, { type: "notify", fromId: selfId, notification: msg.notification });
        else if (!getPushToken(msg.targetId)) {
          send(socket, { type: "error", message: "Doelapparaat voor melding is niet online." });
        }
        const token = getPushToken(msg.targetId);
        if (token) void sendPushNotification(token, selfId, msg.notification);
        break;
      }

      case "notify-response": {
        const target = registry.get(msg.targetId);
        if (target) send(target, { type: "notify-response", notificationId: msg.notificationId, decision: msg.decision });
        break;
      }

      case "register-push-token": {
        const selfId = registry.idFor(socket);
        if (!selfId) return;
        setPushToken(selfId, msg.token);
        break;
      }

      case "bye": {
        const selfId = registry.idFor(socket);
        if (!selfId) return;
        const target = registry.get(msg.targetId);
        if (target) send(target, { type: "peer-disconnected", peerId: selfId });
        break;
      }
    }
  });

  socket.on("close", () => {
    const id = registry.remove(socket);
    if (!id) return;
    console.log(`[close] removed id=${id}`);
    // Best-effort: we don't track who was talking to whom here (that's
    // negotiated peer-to-peer once WebRTC connects), so we don't broadcast
    // disconnects widely — the live WebRTC connection itself will drop and
    // each client detects that locally via RTCPeerConnection state.
  });
});

setInterval(() => connectLimiter.cleanup(), 60_000).unref();

httpServer.listen(PORT, () => {
  console.log(`BromeoRemote signaling server luistert op poort ${PORT}`);
});
