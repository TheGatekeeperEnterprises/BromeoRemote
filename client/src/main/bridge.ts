import { createServer, IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";
import type { NotificationPayload } from "../shared/protocol";

// Local-only HTTP bridge so tools running on THIS machine (e.g. an Antigravity
// agent hook) can push a notification into BromeoRemote, which then relays it
// to wherever you currently are. Never bind this to anything but 127.0.0.1 —
// it has no auth, by design, because only same-machine processes should ever
// reach it (same trust level as any local script already running as you).
export const BRIDGE_PORT = 8973;

interface PendingConfirm {
  resolve: (decision: "allow" | "deny") => void;
}

const pending = new Map<string, PendingConfirm>();

export function resolvePending(id: string, decision: "allow" | "deny"): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  entry.resolve(decision);
  return true;
}

type OnNotification = (notification: NotificationPayload) => void;

const RISK_LEVELS = ["low", "medium", "high"] as const;

function structuredFields(body: Record<string, unknown>): Pick<NotificationPayload, "command" | "cwd" | "riskLevel"> {
  const riskLevel = RISK_LEVELS.includes(body.riskLevel as (typeof RISK_LEVELS)[number])
    ? (body.riskLevel as (typeof RISK_LEVELS)[number])
    : undefined;
  return {
    command: typeof body.command === "string" && body.command ? body.command : undefined,
    cwd: typeof body.cwd === "string" && body.cwd ? body.cwd : undefined,
    riskLevel,
  };
}

export function startBridge(onNotification: OnNotification): void {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/notify") {
      readJson(req)
        .then((body) => {
          const notification: NotificationPayload = {
            id: randomUUID(),
            source: String(body.source ?? "Onbekende bron"),
            title: String(body.title ?? "Melding"),
            message: String(body.message ?? ""),
            kind: "info",
            createdAt: Date.now(),
            ...structuredFields(body),
          };
          onNotification(notification);
          respondJson(res, 202, { ok: true, id: notification.id });
        })
        .catch(() => respondJson(res, 400, { error: "Ongeldige aanvraag" }));
      return;
    }

    if (req.method === "POST" && req.url === "/confirm") {
      readJson(req)
        .then((body) => {
          const notification: NotificationPayload = {
            id: randomUUID(),
            source: String(body.source ?? "Onbekende bron"),
            title: String(body.title ?? "Bevestiging nodig"),
            message: String(body.message ?? ""),
            kind: "confirm",
            createdAt: Date.now(),
            ...structuredFields(body),
          };
          const timeoutMs = Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 120_000;

          const timer = setTimeout(() => resolvePending(notification.id, "deny"), timeoutMs);
          pending.set(notification.id, {
            resolve: (decision) => {
              clearTimeout(timer);
              respondJson(res, 200, { decision });
            },
          });

          onNotification(notification);
        })
        .catch(() => respondJson(res, 400, { error: "Ongeldige aanvraag" }));
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      respondJson(res, 200, { status: "ok" });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on("error", (err) => {
    console.error(`BromeoRemote notification bridge kon niet starten op poort ${BRIDGE_PORT}:`, err.message);
  });
  server.listen(BRIDGE_PORT, "127.0.0.1");
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(new Error("payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
