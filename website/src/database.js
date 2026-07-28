const crypto = require("crypto");
const { Pool } = require("pg");
const { config } = require("./config");

let pool = null;

function databaseEnabled() {
  return Boolean(config.databaseUrl);
}

function getPool() {
  if (!databaseEnabled()) return null;
  if (!pool) {
    const isProduction = process.env.NODE_ENV === "production" ||
                         config.databaseUrl.includes("sslmode=require") ||
                         config.databaseUrl.includes("ssl=true") ||
                         !config.databaseUrl.includes("localhost");
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (err) => {
      console.error("[Database Pool Error]", err.message);
    });
  }
  return pool;
}

async function query(text, params = []) {
  const activePool = getPool();
  if (!activePool) return null;
  return activePool.query(text, params);
}

async function initDatabase() {
  if (!databaseEnabled()) {
    console.warn("DATABASE_URL ontbreekt; website draait zonder opslag.");
    return;
  }

  // Existing tables
  await query(`
    CREATE TABLE IF NOT EXISTS contact_requests (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL,
      company text,
      subject text NOT NULL,
      message text NOT NULL,
      source text NOT NULL DEFAULT 'website',
      ip_address text,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS newsletter_signups (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE,
      source text NOT NULL DEFAULT 'website',
      ip_address text,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS download_events (
      id uuid PRIMARY KEY,
      platform text NOT NULL,
      ip_address text,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Admin accounts
  await query(`
    CREATE TABLE IF NOT EXISTS admin_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'admin',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Users (license holders)
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      company text,
      mollie_customer_id text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Licenses
  await query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan text NOT NULL DEFAULT 'Personal',
      status text NOT NULL DEFAULT 'Active',
      is_trial boolean NOT NULL DEFAULT false,
      trial_days integer NOT NULL DEFAULT 14,
      hwid_hash text,
      mollie_subscription_id text,
      starts_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // License transactions
  await query(`
    CREATE TABLE IF NOT EXISTS license_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mollie_payment_id text,
      amount numeric(10,2) NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'EUR',
      status text NOT NULL DEFAULT 'pending',
      failure_reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Session events (online/offline tracking)
  await query(`
    CREATE TABLE IF NOT EXISTS session_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      hwid_hash text,
      ip_address text,
      platform text NOT NULL DEFAULT 'windows',
      event_type text NOT NULL,
      session_duration_seconds integer,
      app_version text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Admin sessions (express-session compatible)
  await query(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      sid text PRIMARY KEY,
      sess json NOT NULL,
      expire timestamptz NOT NULL
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expire ON admin_sessions (expire);`);

  await query("CREATE INDEX IF NOT EXISTS idx_contact_requests_created_at ON contact_requests (created_at DESC);");
  await query("CREATE INDEX IF NOT EXISTS idx_download_events_created_at ON download_events (created_at DESC);");
  await query("CREATE INDEX IF NOT EXISTS idx_licenses_user_id ON licenses (user_id);");
  await query("CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON session_events (created_at DESC);");

  // Seed admin account if it doesn't exist
  await seedAdminAccount();
}

async function seedAdminAccount() {
  const bcrypt = require("bcrypt");
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "info@bromeoremote.com";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Site9373!";

  const existing = await query("SELECT id FROM admin_accounts WHERE email = $1", [ADMIN_EMAIL]);
  if (existing && existing.rows.length > 0) return;

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await query(
    "INSERT INTO admin_accounts (email, password_hash, role) VALUES ($1, $2, 'superadmin')",
    [ADMIN_EMAIL, hash]
  );
  console.log(`[Admin] Account aangemaakt: ${ADMIN_EMAIL}`);
}

async function healthCheck() {
  if (!databaseEnabled()) return { configured: false, ok: false };
  try {
    await query("SELECT 1;");
    return { configured: true, ok: true };
  } catch (error) {
    return { configured: true, ok: false, error: error.message };
  }
}

async function saveContactRequest(contact, requestMeta) {
  if (!databaseEnabled()) return null;
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO contact_requests (id, name, email, company, subject, message, source, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, 'website', $7, $8);`,
    [id, contact.name, contact.email, contact.company, contact.subject, contact.message, requestMeta.ip, requestMeta.userAgent],
  );
  return id;
}

async function saveNewsletterSignup(signup, requestMeta) {
  if (!databaseEnabled()) return null;
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO newsletter_signups (id, email, source, ip_address, user_agent)
     VALUES ($1, $2, 'website', $3, $4)
     ON CONFLICT (email)
     DO UPDATE SET updated_at = now(), ip_address = EXCLUDED.ip_address, user_agent = EXCLUDED.user_agent;`,
    [id, signup.email, requestMeta.ip, requestMeta.userAgent],
  );
  return id;
}

async function saveDownloadEvent(platform, requestMeta) {
  if (!databaseEnabled()) return null;
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO download_events (id, platform, ip_address, user_agent) VALUES ($1, $2, $3, $4);`,
    [id, platform, requestMeta.ip, requestMeta.userAgent],
  );
  return id;
}

async function closeDatabase() {
  if (pool) await pool.end();
}

// ── Admin queries ──────────────────────────────────────────────────────────────

async function adminGetStats() {
  const [users, licenses, activeLicenses, trialLicenses, sessions7d, downloads7d] = await Promise.all([
    query("SELECT COUNT(*) AS count FROM users"),
    query("SELECT COUNT(*) AS count FROM licenses"),
    query("SELECT COUNT(*) AS count FROM licenses WHERE status = 'Active' AND is_trial = false"),
    query("SELECT COUNT(*) AS count FROM licenses WHERE is_trial = true AND status = 'Active'"),
    query("SELECT COUNT(*) AS count FROM session_events WHERE created_at > now() - interval '7 days'"),
    query("SELECT COUNT(*) AS count FROM download_events WHERE created_at > now() - interval '7 days'"),
  ]);
  return {
    totalUsers: parseInt(users?.rows[0]?.count || 0),
    totalLicenses: parseInt(licenses?.rows[0]?.count || 0),
    activeLicenses: parseInt(activeLicenses?.rows[0]?.count || 0),
    trialLicenses: parseInt(trialLicenses?.rows[0]?.count || 0),
    sessions7d: parseInt(sessions7d?.rows[0]?.count || 0),
    downloads7d: parseInt(downloads7d?.rows[0]?.count || 0),
  };
}

async function adminGetUsers({ page = 1, limit = 20, search = "" } = {}) {
  const offset = (page - 1) * limit;
  const searchParam = `%${search}%`;
  const result = await query(
    `SELECT u.id, u.email, u.company, u.created_at,
       l.plan, l.status, l.is_trial, l.expires_at,
       (SELECT created_at FROM session_events WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_seen
     FROM users u
     LEFT JOIN licenses l ON l.user_id = u.id
     WHERE u.email ILIKE $1 OR u.company ILIKE $1
     ORDER BY u.created_at DESC
     LIMIT $2 OFFSET $3`,
    [searchParam, limit, offset]
  );
  const countResult = await query(
    "SELECT COUNT(*) AS count FROM users WHERE email ILIKE $1 OR company ILIKE $1",
    [searchParam]
  );
  return {
    users: result?.rows || [],
    total: parseInt(countResult?.rows[0]?.count || 0),
    page,
    limit,
  };
}

async function adminGetUser(userId) {
  const user = await query("SELECT * FROM users WHERE id = $1", [userId]);
  const licenses = await query("SELECT * FROM licenses WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  const transactions = await query("SELECT * FROM license_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20", [userId]);
  const sessions = await query(
    "SELECT * FROM session_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
    [userId]
  );
  return {
    user: user?.rows[0] || null,
    licenses: licenses?.rows || [],
    transactions: transactions?.rows || [],
    sessions: sessions?.rows || [],
  };
}

async function adminUpsertUser({ email, company, notes }) {
  const id = crypto.randomUUID();
  const result = await query(
    `INSERT INTO users (id, email, company, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET company = EXCLUDED.company, notes = EXCLUDED.notes, updated_at = now()
     RETURNING *`,
    [id, email, company || null, notes || null]
  );
  return result?.rows[0];
}

async function adminCreateLicense({ userId, plan, status, isTrial, trialDays, expiresAt, notes }) {
  const result = await query(
    `INSERT INTO licenses (user_id, plan, status, is_trial, trial_days, expires_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, plan || "Personal", status || "Active", isTrial || false, trialDays || 14, expiresAt || null, notes || null]
  );
  return result?.rows[0];
}

async function adminUpdateLicense(licenseId, { plan, status, isTrial, expiresAt, notes, hwidHash }) {
  const result = await query(
    `UPDATE licenses SET plan=$1, status=$2, is_trial=$3, expires_at=$4, notes=$5, hwid_hash=$6, updated_at=now()
     WHERE id=$7 RETURNING *`,
    [plan, status, isTrial, expiresAt || null, notes || null, hwidHash || null, licenseId]
  );
  return result?.rows[0];
}

async function adminResetHwid(licenseId) {
  const result = await query(
    "UPDATE licenses SET hwid_hash = NULL, updated_at = now() WHERE id = $1 RETURNING *",
    [licenseId]
  );
  return result?.rows[0];
}

async function adminGetSessions({ page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const result = await query(
    `SELECT se.*, u.email FROM session_events se
     LEFT JOIN users u ON u.id = se.user_id
     ORDER BY se.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result?.rows || [];
}

async function adminVerifyLogin(email, password) {
  const bcrypt = require("bcrypt");
  const result = await query("SELECT * FROM admin_accounts WHERE email = $1", [email]);
  if (!result || result.rows.length === 0) return null;
  const admin = result.rows[0];
  const match = await bcrypt.compare(password, admin.password_hash);
  return match ? admin : null;
}

// Record a session event from the client/app
async function recordSessionEvent({ userId, hwidHash, ipAddress, platform, eventType, durationSeconds, appVersion }) {
  if (!databaseEnabled()) return null;
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO session_events (id, user_id, hwid_hash, ip_address, platform, event_type, session_duration_seconds, app_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, userId || null, hwidHash || null, ipAddress || null, platform || "windows", eventType, durationSeconds || null, appVersion || null]
  );
  return id;
}

module.exports = {
  closeDatabase,
  databaseEnabled,
  healthCheck,
  initDatabase,
  saveContactRequest,
  saveDownloadEvent,
  saveNewsletterSignup,
  // Admin
  adminGetStats,
  adminGetUsers,
  adminGetUser,
  adminUpsertUser,
  adminCreateLicense,
  adminUpdateLicense,
  adminResetHwid,
  adminGetSessions,
  adminVerifyLogin,
  recordSessionEvent,
  getPool,
};
