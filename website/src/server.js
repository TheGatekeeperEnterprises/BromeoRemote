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
  recordSessionEvent,
} = require("./database");
const { sendContactNotification } = require("./mailer");
const { hasErrors, validateContact, validateNewsletter, validatePlatform } = require("./validation");
const { router: adminRouter, createAdminSession } = require("./admin");

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
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(compression());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

// Admin panel (session + router)
app.use(createAdminSession());
app.use("/admin", adminRouter);

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
        const match = files.find((f) => pattern.test(f));
        if (match) {
          const fullPath = path.join(dir, match);
          return { path: fullPath, filename: match };
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

function downloadUrlForPlatform(platform) {
  switch (platform) {
    case "windows":
      return config.downloads.windows;
    case "windows-portable":
      return config.downloads.windowsPortable;
    case "android":
      return config.downloads.android;
    case "github":
      return config.downloads.github;
    default:
      return "";
  }
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
    const targetUrl = downloadUrlForPlatform(platform);
    if (targetUrl) {
      res.redirect(302, targetUrl);
      return;
    }

    res.status(503).json({ ok: false, error: "Deze download is nog niet gekoppeld." });
  } catch (error) {
    next(error);
  }
});

const { createSubscriptionCheckout } = require("./licensing");

app.post("/api/checkout", apiLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "Geldig e-mailadres is verplicht." });
    }
    // TODO: Link with real users table, for now we pass a dummy user UUID
    const dummyUserId = "00000000-0000-0000-0000-000000000000";
    const checkoutUrl = await createSubscriptionCheckout(email, dummyUserId);
    res.json({ ok: true, url: checkoutUrl });
  } catch (error) {
    next(error);
  }
});

app.post("/api/webhooks/mollie", express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const paymentId = req.body.id;
    if (!paymentId) return res.status(400).send("No payment ID");
    
    // In production, fetch the payment via mollieClient.payments.get(paymentId)
    // and update the license / transaction status in the PostgreSQL database.
    console.log(`[Mollie Webhook] Received status update for payment: ${paymentId}`);
    
    res.status(200).send("OK");
  } catch (error) {
    next(error);
  }
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
