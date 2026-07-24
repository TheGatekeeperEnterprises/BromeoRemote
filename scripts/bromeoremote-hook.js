#!/usr/bin/env node
/**
 * bromeoremote-hook.js — Google Antigravity PreToolUse hook for BromeoRemote
 * 
 * Vraagt BromeoRemote (lokale HTTP bridge op http://localhost:8973/confirm) om
 * mobiele/externe bevestiging voor risicovolle tool-acties.
 * 
 * Input (stdin JSON):
 *   { toolCall: { name, args }, stepIdx, conversationId, workspacePaths, transcriptPath, artifactDirectoryPath }
 * 
 * Output (stdout JSON):
 *   { decision: "allow" | "deny" | "ask" | "force_ask", reason?: string }
 */

const fs = require("fs");
const http = require("http");

function postConfirm(bodyData) {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(bodyData);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 8973,
        path: "/confirm",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(dataString),
        },
        timeout: 125000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error("Ongeldige JSON-reactie van BromeoRemote bridge"));
          }
        });
      }
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("BromeoRemote bridge time-out"));
    });

    req.write(dataString);
    req.end();
  });
}

async function main() {
  let payload;
  try {
    const input = fs.readFileSync(0, "utf8");
    payload = JSON.parse(input);
  } catch (err) {
    // Bij foutieve stdin, val terug op "ask" (lokale prompt in Antigravity)
    console.log(JSON.stringify({ decision: "ask", reason: `Hook input parse error: ${err.message}` }));
    return;
  }

  const toolName = payload.toolCall?.name ?? "onbekende actie";
  const args = payload.toolCall?.args ?? {};

  // Extracteer exact commando/bestandspad en werkwijze
  const command = args.CommandLine ?? args.command ?? args.TargetFile ?? args.AbsolutePath ?? (typeof args === "object" ? JSON.stringify(args) : String(args));
  const cwd = args.Cwd ?? (payload.workspacePaths ?? [])[0] ?? process.cwd();

  // Bepaal risiconiveau
  let riskLevel = "medium";
  if (toolName === "run_command" || toolName === "unsandboxed") {
    riskLevel = "high";
  } else if (toolName === "write_to_file" || toolName === "replace_file_content" || toolName === "multi_replace_file_content") {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  try {
    const data = await postConfirm({
      source: "Google Antigravity",
      title: `Bevestiging voor ${toolName}`,
      message: `Antigravity vraagt toestemming voor actie '${toolName}'`,
      command: command,
      cwd: cwd,
      riskLevel: riskLevel,
      timeoutMs: 120000, // 2 minuten om te reageren via mobiel/app
    });

    const decision = data && data.decision === "allow" ? "allow" : "deny";
    console.log(JSON.stringify({ decision }));
  } catch (err) {
    // BromeoRemote bridge onbereikbaar (app niet gestart) -> val terug op "ask"
    console.log(JSON.stringify({
      decision: "ask",
      reason: `BromeoRemote-brug onbereikbaar: ${err.message}`
    }));
  }
}

main();
