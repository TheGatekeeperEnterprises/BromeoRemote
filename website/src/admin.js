const fs = require("fs");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");
const { config } = require("./config");
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
  adminGetTransactions,
  adminGetContactRequests,
  adminGetNewsletterSignups,
  adminDeleteUser,
  adminDeleteLicense,
  adminGetAdmins,
  adminCreateAdmin,
  adminCountSuperAdmins,
  adminGetAdminById,
  adminDeleteAdmin,
  adminGetFullStatistics,
  adminGetCommercialUsageStats,
  databaseEnabled,
  getPool,
} = require("./database");
const { cancelUserSubscription } = require("./licensing");

const router = express.Router();

// ── Analytics API ─────────────────────────────────────────────────────────────
router.get(["/api/analytics", "/api/statistics"], requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const filterInternal = req.query.filterInternal === "true";
    const filterBots = req.query.filterBots === "true";
    const stats = await adminGetFullStatistics({ days, filterInternal, filterBots });
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
      secure: config.env === "production",
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

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.adminRole === "superadmin") return next();
  res.status(403).json({ ok: false, error: "Alleen voor superadmins." });
}

// ── Serve admin HTML ─────────────────────────────────────────────────────────
function getAdminDir() {
  const candidates = [
    path.join(__dirname, "..", "admin"),
    path.join(__dirname, "admin"),
    path.join(process.cwd(), "admin"),
    path.join(process.cwd(), "website", "admin"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(__dirname, "..", "admin");
}
const adminDir = getAdminDir();

router.get("/login", (req, res) => {
  if (req.session && req.session.adminId) return res.redirect("/admin");
  res.sendFile(path.join(adminDir, "login.html"));
});

// Serve static assets in admin directory (e.g. world.svg)
router.use(express.static(adminDir, { index: false }));

router.get(["/", "/users", "/users/:id", "/sessions", "/transactions", "/leads", "/admins", "/analytics", "/commercial-usage"], requireAuth, (req, res) => {
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
  res.json({ ok: true, id: req.session.adminId, email: req.session.adminEmail, role: req.session.adminRole });
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
    const platform = req.query.platform || "";
    const eventType = req.query.eventType || "";
    const sessions = await adminGetSessions({ page, platform, eventType });
    res.json({ ok: true, sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Transactions API ──────────────────────────────────────────────────────────
router.get("/api/transactions", requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || "";
    const data = await adminGetTransactions({ page, status });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Leads API ─────────────────────────────────────────────────────────────────
router.get("/api/leads/contact", requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await adminGetContactRequests({ page });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/leads/newsletter", requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const data = await adminGetNewsletterSignups({ page });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Destructive user/license actions ───────────────────────────────────────────
router.delete("/api/users/:id", requireAuth, async (req, res) => {
  try {
    await adminDeleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete("/api/licenses/:id", requireAuth, async (req, res) => {
  try {
    await adminDeleteLicense(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/api/users/:id/cancel-subscription", requireAuth, async (req, res) => {
  try {
    await cancelUserSubscription(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Admin accounts management (superadmin only) ────────────────────────────────
router.get("/api/admins", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await adminGetAdmins();
    res.json({ ok: true, admins });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/api/admins", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: "E-mail en wachtwoord zijn verplicht." });
    if (password.length < 8) return res.status(400).json({ ok: false, error: "Wachtwoord moet minstens 8 tekens zijn." });
    const admin = await adminCreateAdmin({ email, password, role: role === "superadmin" ? "superadmin" : "admin" });
    res.json({ ok: true, admin });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete("/api/admins/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    if (req.params.id === req.session.adminId) {
      return res.status(400).json({ ok: false, error: "Je kunt je eigen account niet verwijderen." });
    }
    const target = await adminGetAdminById(req.params.id);
    if (!target) return res.status(404).json({ ok: false, error: "Beheerder niet gevonden." });
    if (target.role === "superadmin") {
      const superAdminCount = await adminCountSuperAdmins();
      if (superAdminCount <= 1) {
        return res.status(400).json({ ok: false, error: "Kan de laatste superadmin niet verwijderen." });
      }
    }
    await adminDeleteAdmin(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Commercial usage (Fase 1: alleen meten) ─────────────────────────────────────
router.get("/api/commercial-usage", requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const devices = await adminGetCommercialUsageStats({ days });
    res.json({ ok: true, devices });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router, createAdminSession };
