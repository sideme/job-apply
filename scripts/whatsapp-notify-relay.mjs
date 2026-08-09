import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = process.env.WHATSAPP_RELAY_PORT
  ? parseInt(process.env.WHATSAPP_RELAY_PORT, 10)
  : 8787;
const CALLMEBOT_PHONE = process.env.CALLMEBOT_PHONE;
const CALLMEBOT_API_KEY = process.env.CALLMEBOT_API_KEY;
const RELAY_SECRET =
  process.env.WHATSAPP_RELAY_SECRET || process.env.WEBHOOK_SECRET;
const MAX_BODY_BYTES = 64 * 1024;

if (!CALLMEBOT_PHONE || !CALLMEBOT_API_KEY || !RELAY_SECRET) {
  console.error(
    "CALLMEBOT_PHONE, CALLMEBOT_API_KEY, and WHATSAPP_RELAY_SECRET (or WEBHOOK_SECRET) must be set",
  );
  process.exit(1);
}

function isAuthorized(authorization) {
  const expected = Buffer.from(`Bearer ${RELAY_SECRET}`);
  const actual = Buffer.from(authorization || "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function formatMessage(payload) {
  const event = payload.event ?? "unknown_event";
  if (event === "linkedin.circuit_breaker_tripped") {
    return `job-apply: LinkedIn circuit breaker tripped (cooldown until ${payload.cooldownUntil}). ${payload.error ?? ""}`.trim();
  }
  if (event === "pipeline.failed") {
    return `job-apply: pipeline run failed. ${payload.error ?? ""}`.trim();
  }
  if (event === "pipeline.completed") {
    return `job-apply: pipeline run completed — discovered ${payload.jobsDiscovered ?? "?"}, processed ${payload.jobsProcessed ?? "?"}.`;
  }
  return `job-apply: ${event}`;
}

async function forwardToWhatsApp(message) {
  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", CALLMEBOT_PHONE);
  url.searchParams.set("text", message);
  url.searchParams.set("apikey", CALLMEBOT_API_KEY);

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text().catch(() => "");
  // CallMeBot returns HTTP 200 even for an invalid/expired key, with the
  // failure described in the body (e.g. "ERROR: apikey ... invalid format").
  // Treat that as a delivery failure so a broken key surfaces as a 502 here
  // instead of silently swallowing every notification.
  if (!response.ok || body.includes("ERROR")) {
    throw new Error(
      `CallMeBot request failed: ${response.status} ${body.slice(0, 200)}`.trim(),
    );
  }
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  if (!isAuthorized(req.headers.authorization)) {
    res
      .writeHead(401, { "Content-Type": "application/json" })
      .end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    return;
  }

  let body = "";
  let tooLarge = false;
  req.on("data", (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      tooLarge = true;
      res
        .writeHead(413, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: false, error: "Payload too large" }));
    }
  });
  req.on("end", async () => {
    if (tooLarge) return;
    try {
      const payload = JSON.parse(body || "{}");
      const message = formatMessage(payload);
      await forwardToWhatsApp(message);
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: true }));
    } catch (error) {
      console.error("whatsapp-notify-relay error:", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      res
        .writeHead(502, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({ ok: false, error: "Notification delivery failed" }),
        );
    }
  });
});

server.listen(PORT, () => {
  console.log(`whatsapp-notify-relay listening on http://localhost:${PORT}`);
});
