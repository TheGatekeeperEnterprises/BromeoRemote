const fs = require("fs");
const path = require("path");
const compression = require("compression");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { config } = require("./config");
const {
  closeDatabase,
  healthCheck,
  initDatabase,
  saveContactRequest,
  saveDownloadEvent,
  saveNewsletterSignup,
  recordPageView,
  recordSessionEvent,
  recordRemoteSession,
  resolveUserIdByLicenseOrEmail,
  userRegister,
  userLogin,
  userGetPortalData,
} = require("./database");
const { sendContactNotification } = require("./mailer");
const { hasErrors, validateContact, validateNewsletter, validatePlatform } = require("./validation");
const { router: adminRouter, createAdminSession } = require("./admin");
const { createUserSession } = require("./userSession");

const app = express();
const publicDir = path.join(__dirname, "..", "public");
const releasesDir = path.join(__dirname, "..", "..", "releases");

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        // Allow inline scripts for admin panel
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(compression());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

// Separate session middleware per audience — see userSession.js for why this
// used to be a single global admin session shared with customer logins.
const userSessionMw = createUserSession();
app.use((req, res, next) => (req.path.startsWith("/admin") ? next() : userSessionMw(req, res, next)));
app.use("/admin", createAdminSession(), adminRouter);

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const contactLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});


let latestReleaseCache = { data: null, expiresAt: 0 };

async function fetchLatestGitHubReleaseAssets() {
  const now = Date.now();
  if (latestReleaseCache.data && now < latestReleaseCache.expiresAt) {
    return latestReleaseCache.data;
  }

  try {
    const response = await fetch("https://api.github.com/repos/TheGatekeeperEnterprises/BromeoRemote/releases/latest", {
      headers: { "User-Agent": "BromeoRemote-Website-Server" },
    });

    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !Array.isArray(data.assets)) return null;

    const assets = {
      windows: data.assets.find((a) => /installer.*\.exe$/i.test(a.name) || /\.exe$/i.test(a.name))?.browser_download_url,
      "windows-portable": data.assets.find((a) => /setup.*\.exe$/i.test(a.name) || /portable.*\.exe$/i.test(a.name))?.browser_download_url,
      android: data.assets.find((a) => /\.apk$/i.test(a.name))?.browser_download_url,
    };

    latestReleaseCache = { data: assets, expiresAt: now + 3 * 60 * 1000 }; // 3 min cache
    return assets;
  } catch (err) {
    console.error("[releases] error fetching GitHub latest release:", err.message);
    return null;
  }
}

function getLocalReleaseFile(platform) {
  const dirs = [
    path.join(__dirname, "..", "public", "downloads"),
    path.join(__dirname, "..", "..", "releases"),
    path.join(__dirname, "..", "releases"),
    "/app/releases",
    "/app/public/downloads",
  ];

  const patterns = {
    windows: [/installer/i, /installer\.exe$/i, /\.exe$/i],
    "windows-portable": [/setup/i, /portable/i, /setup\.exe$/i],
    android: [/\.apk$/i],
  };

  const currentPatterns = patterns[platform] || [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const pattern of currentPatterns) {
        const matches = files.filter((f) => pattern.test(f));
        if (matches.length > 0) {
          const sorted = matches
            .map((f) => {
              const p = path.join(dir, f);
              const stat = fs.statSync(p);
              return { path: p, filename: f, mtime: stat.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime);

          return { path: sorted[0].path, filename: sorted[0].filename };
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  return null;
}

function requestMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  };
}

async function downloadUrlForPlatform(platform) {
  let configured = "";
  switch (platform) {
    case "windows":
      configured = config.downloads.windows;
      break;
    case "windows-portable":
      configured = config.downloads.windowsPortable;
      break;
    case "android":
      configured = config.downloads.android;
      break;
    case "github":
      configured = config.downloads.github;
      break;
  }

  if (configured && configured.trim().length > 0) return configured;

  const latestAssets = await fetchLatestGitHubReleaseAssets();
  if (latestAssets && latestAssets[platform]) {
    return latestAssets[platform];
  }

  return "https://github.com/TheGatekeeperEnterprises/BromeoRemote/releases";
}

app.get("/health", async (_req, res) => {
  const database = await healthCheck();
  const ok = !database.configured || database.ok;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    app: "bromeoremote-website",
    database,
  });
});

app.get("/api/site-config", apiLimiter, (_req, res) => {
  res.json({
    baseUrl: config.publicBaseUrl,
    downloads: {
      windows: true,
      windowsPortable: true,
      android: true,
      github: Boolean(config.downloads.github),
    },
    links: config.links,
  });
});

app.post("/api/contact", contactLimiter, async (req, res, next) => {
  try {
    const { value, errors } = validateContact(req.body);
    if (hasErrors(errors)) {
      res.status(400).json({ ok: false, errors });
      return;
    }

    const id = await saveContactRequest(value, requestMeta(req));
    const mailed = await sendContactNotification(value);
    res.status(202).json({ ok: true, id, mailed });
  } catch (error) {
    next(error);
  }
});

app.post("/api/newsletter", contactLimiter, async (req, res, next) => {
  try {
    const { value, errors } = validateNewsletter(req.body);
    if (hasErrors(errors)) {
      res.status(400).json({ ok: false, errors });
      return;
    }

    const id = await saveNewsletterSignup(value, requestMeta(req));
    res.status(202).json({ ok: true, id });
  } catch (error) {
    next(error);
  }
});

app.get("/download/:platform", apiLimiter, async (req, res, next) => {
  try {
    const platform = validatePlatform(req.params.platform);
    if (!platform) {
      res.status(404).json({ ok: false, error: "Onbekend downloadplatform." });
      return;
    }

    await saveDownloadEvent(platform, requestMeta(req));

    // 1. Check if file is available locally on the server
    const localFile = getLocalReleaseFile(platform);
    if (localFile) {
      res.download(localFile.path, localFile.filename);
      return;
    }

    // 2. Redirect to configured or GitHub fallback URL
    const targetUrl = await downloadUrlForPlatform(platform);
    if (targetUrl) {
      res.redirect(302, targetUrl);
      return;
    }

    res.status(503).json({ ok: false, error: "Deze download is nog niet gekoppeld." });
  } catch (error) {
    next(error);
  }
});

const { createSubscriptionCheckout, handleMollieWebhook, cancelUserSubscription, verifyLicense } = require("./licensing");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const {
  setPasswordResetToken,
  getUserByResetToken,
  resetUserPassword,
  regenerateLicenseKey,
} = require("./database");
const { sendPasswordResetEmail } = require("./mailer");

function requireUserSession(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ ok: false, error: "Niet ingelogd." });
    return null;
  }
  return req.session.userId;
}

app.post("/api/license/verify", apiLimiter, async (req, res, next) => {
  try {
    const { licenseKey, email, hwid, platform, appVersion } = req.body;
    const ipAddress = req.ip;
    const result = await verifyLicense({ licenseKey, email, hwid, platform, appVersion, ipAddress });
    if (!result.valid) {
      return res.status(403).json(result);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Fase 1 commercial-use measurement: viewer side reports one row per
// completed session. Unauthenticated by design, same precedent as
// /api/license/verify — most Free accounts never register at all, so
// source_device_id (not a login) is the primary identity here.
app.post("/api/session/report", apiLimiter, async (req, res, next) => {
  try {
    const { deviceId, targetDeviceId, platform, startedAt, endedAt, licenseKey, email } = req.body;
    if (!deviceId || !startedAt || !endedAt) {
      return res.status(400).json({ ok: false, error: "deviceId, startedAt en endedAt zijn verplicht." });
    }
    const userId = await resolveUserIdByLicenseOrEmail({ licenseKey, email });
    await recordRemoteSession({
      userId,
      sourceDeviceId: deviceId,
      targetDeviceId,
      platform,
      ipAddress: req.ip,
      startedAt,
      endedAt,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ── User Portal Auth API ───────────────────────────────────────────────────────
app.post("/api/user/register", contactLimiter, async (req, res, next) => {
  try {
    const { email, password, company } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "Een geldig e-mailadres is verplicht." });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ ok: false, error: "Wachtwoord moet minimaal 6 tekens bevatten." });
    }

    const { user, license } = await userRegister({ email, password, company });
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.json({ ok: true, user, license });
  } catch (error) {
    if (error.message && error.message.includes("al een account")) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next(error);
  }
});

app.post("/api/user/login", contactLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "E-mailadres en wachtwoord zijn verplicht." });
    }

    const data = await userLogin({ email, password });
    if (!data) {
      return res.status(401).json({ ok: false, error: "Onjuiste e-mail of wachtwoord." });
    }

    req.session.userId = data.user.id;
    req.session.userEmail = data.user.email;
    res.json({ ok: true, ...data });
  } catch (error) {
    next(error);
  }
});

app.post("/api/user/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/user/me", async (req, res, next) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ ok: false, error: "Niet ingelogd." });
    }
    const data = await userGetPortalData(req.session.userId);
    if (!data) {
      return res.status(404).json({ ok: false, error: "Gebruiker niet gevonden." });
    }
    res.json({ ok: true, ...data });
  } catch (error) {
    next(error);
  }
});

app.post("/api/checkout", apiLimiter, async (req, res, next) => {
  try {
    // A real user account is required now — the transaction/license rows
    // created during checkout are foreign-keyed to a real users.id, so an
    // anonymous checkout has nothing valid to attach to.
    const userId = requireUserSession(req, res);
    if (!userId) return;
    const plan = req.body.plan === "Unlimited" ? "Unlimited" : "Pro";
    const email = req.session.userEmail;

    const checkoutUrl = await createSubscriptionCheckout(email, userId, plan);
    res.json({ ok: true, url: checkoutUrl });
  } catch (error) {
    next(error);
  }
});

app.post("/api/user/cancel-subscription", apiLimiter, async (req, res, next) => {
  try {
    const userId = requireUserSession(req, res);
    if (!userId) return;
    const license = await cancelUserSubscription(userId);
    res.json({ ok: true, license });
  } catch (error) {
    if (error.message && error.message.includes("Geen actief abonnement")) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next(error);
  }
});

app.post("/api/user/regenerate-license-key", apiLimiter, async (req, res, next) => {
  try {
    const userId = requireUserSession(req, res);
    if (!userId) return;
    const license = await regenerateLicenseKey(userId);
    res.json({ ok: true, license });
  } catch (error) {
    next(error);
  }
});

app.post("/api/user/forgot-password", contactLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    // Always respond the same way regardless of whether the email exists —
    // otherwise this endpoint becomes a way to enumerate registered emails.
    if (email && email.includes("@")) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      const user = await setPasswordResetToken(email, tokenHash, expiresAt);
      if (user) {
        const resetUrl = `${config.publicBaseUrl}/?resetToken=${token}`;
        await sendPasswordResetEmail(user.email, resetUrl);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/user/reset-password", contactLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: "Ongeldig verzoek of wachtwoord te kort (min. 6 tekens)." });
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await getUserByResetToken(tokenHash);
    if (!user) {
      return res.status(400).json({ ok: false, error: "Deze resetlink is ongeldig of verlopen." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await resetUserPassword(user.id, passwordHash);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/webhooks/mollie", express.urlencoded({ extended: true }), async (req, res) => {
  const paymentId = req.body.id;
  if (!paymentId) return res.status(400).send("No payment ID");
  try {
    await handleMollieWebhook(paymentId);
    res.status(200).send("OK");
  } catch (error) {
    // Non-200 makes Mollie retry the webhook later — safe since
    // handleMollieWebhook is idempotent per mollie_payment_id.
    console.error("[Mollie Webhook] processing failed:", error.message);
    res.status(500).send("Webhook processing failed");
  }
});

// dashboard.html no longer exists — the whole account/license flow is now a
// modal on the homepage (see public/app.js's initAccountModal). This keeps
// old bookmarks and already-sent password-reset emails working instead of
// 404ing; registered before static serving so it takes precedence.
app.get("/dashboard.html", (req, res) => {
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(302, "/" + query);
});

// Lightweight server-side visitor tracking — only real page navigations
// (GET, HTML accept, no file extension, not API/admin/releases), never assets.
// Must run before express.static(publicDir) below, since that middleware
// auto-resolves "/" to index.html and would otherwise short-circuit the
// request before this ever saw it.
app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    !req.path.startsWith("/api") &&
    !req.path.startsWith("/admin") &&
    !req.path.startsWith("/releases") &&
    !path.extname(req.path) &&
    (req.headers.accept || "").includes("text/html")
  ) {
    recordPageView({
      path: req.path,
      referrer: req.get("referer") || null,
      ip: req.ip,
      userAgent: req.get("user-agent") || null,
    }).catch(() => {});
  }
  next();
});

app.use("/releases", express.static(releasesDir));

app.use(
  express.static(publicDir, {
    etag: true,
    maxAge: "1d",
    setHeaders(res, filePath) {
      if (/\.(html|css|js|xml|webmanifest)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    },
  }),
);

app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: "Er ging iets mis. Probeer het later opnieuw." });
});

async function start() {
  await initDatabase();
  const server = app.listen(config.port, () => {
    console.log(`BromeoRemote website luistert op poort ${config.port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
