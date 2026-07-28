const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");
const {
  adminVerifyLogin,
  adminGetStats,
  adminGetUsers,
  adminGetUser,
  adminUpsertUser,
  adminCreateLicense,
  adminUpdateLicense,
  adminResetHwid,
  adminGetSessions,
  databaseEnabled,
  getPool,
} = require("./database");

const router = express.Router();

// ── Session middleware ────────────────────────────────────────────────────────
function createAdminSession() {
  const store = databaseEnabled()
    ? new pgSession({ pool: getPool(), tableName: "admin_sessions", createTableIfMissing: true })
    : new session.MemoryStore();

  const sessionMw = session({
    store,
    secret: process.env.SESSION_SECRET || "bromeoremote-admin-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
      httpOnly: true,
      sameSite: "lax",
    },
    name: "br_admin_sid",
  });

  return (req, res, next) => {
    sessionMw(req, res, (err) => {
      if (err) {
        console.error("[Session Error]", err.message);
        // Do not crash page load if session error occurs
        if (!req.path.startsWith("/api/")) {
          return next();
        }
      }
      next(err);
    });
  };
}

function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (req.xhr || req.path.startsWith("/api/")) {
    return res.status(401).json({ ok: false, error: "Niet ingelogd" });
  }
  res.redirect("/admin/login");
}

// ── Serve admin HTML ─────────────────────────────────────────────────────────
const adminDir = path.join(__dirname, "..", "admin");

router.get("/login", (req, res) => {
  if (req.session && req.session.adminId) return res.redirect("/admin");
  res.sendFile(path.join(adminDir, "login.html"));
});

router.get(["/", "/users", "/users/:id", "/sessions"], requireAuth, (req, res) => {
  res.sendFile(path.join(adminDir, "index.html"));
});

// ── Auth API ─────────────────────────────────────────────────────────────────
router.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: "E-mail en wachtwoord zijn verplicht." });

    const admin = await adminVerifyLogin(email, password);
    if (!admin) return res.status(401).json({ ok: false, error: "Onjuiste inloggegevens." });

    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    req.session.adminRole = admin.role;
    res.json({ ok: true, email: admin.email, role: admin.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Serverfout." });
  }
});

router.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/api/me", requireAuth, (req, res) => {
  res.json({ ok: true, email: req.session.adminEmail, role: req.session.adminRole });
});

// ── Stats API ─────────────────────────────────────────────────────────────────
router.get("/api/stats", requireAuth, async (req, res) => {
  try {
    const stats = await adminGetStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Users API ─────────────────────────────────────────────────────────────────
router.get("/api/users", requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || "";
    const data = await adminGetUsers({ page, search });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/users/:id", requireAuth, async (req, res) => {
  try {
    const data = await adminGetUser(req.params.id);
    if (!data.user) return res.status(404).json({ ok: false, error: "Gebruiker niet gevonden." });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/api/users", requireAuth, async (req, res) => {
  try {
    const { email, company, notes } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: "E-mail is verplicht." });
    const user = await adminUpsertUser({ email, company, notes });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Licenses API ──────────────────────────────────────────────────────────────
router.post("/api/users/:id/licenses", requireAuth, async (req, res) => {
  try {
    const { plan, status, isTrial, trialDays, expiresAt, notes } = req.body;
    const license = await adminCreateLicense({
      userId: req.params.id,
      plan,
      status,
      isTrial: isTrial === true || isTrial === "true",
      trialDays: parseInt(trialDays) || 14,
      expiresAt,
      notes,
    });
    res.json({ ok: true, license });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch("/api/licenses/:id", requireAuth, async (req, res) => {
  try {
    const { plan, status, isTrial, expiresAt, notes, hwidHash } = req.body;
    const license = await adminUpdateLicense(req.params.id, { plan, status, isTrial, expiresAt, notes, hwidHash });
    res.json({ ok: true, license });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/api/licenses/:id/reset-hwid", requireAuth, async (req, res) => {
  try {
    const license = await adminResetHwid(req.params.id);
    res.json({ ok: true, license });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Sessions API ──────────────────────────────────────────────────────────────
router.get("/api/sessions", requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const sessions = await adminGetSessions({ page });
    res.json({ ok: true, sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router, createAdminSession };
