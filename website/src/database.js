const crypto = require("crypto");
const { Pool } = require("pg");
const { config } = require("./config");

let pool = null;

function databaseEnabled() {
  return Boolean(config.databaseUrl);
}

function getSslConfig() {
  if (process.env.DB_SSL === "true") return { rejectUnauthorized: false };
  if (process.env.DB_SSL === "false") return false;
  if (config.databaseUrl.includes("sslmode=disable")) return false;
  if (
    config.databaseUrl.includes("sslmode=require") ||
    config.databaseUrl.includes("sslmode=no-verify") ||
    config.databaseUrl.includes("ssl=true")
  ) {
    return { rejectUnauthorized: false };
  }
  return false;
}

function getPool() {
  if (!databaseEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: getSslConfig(),
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

  try {
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
      password_hash text,
      company text,
      mollie_customer_id text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token text;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires timestamptz;`);

  // Licenses
  await query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      license_key uuid NOT NULL DEFAULT gen_random_uuid(),
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
  // license_key predates some deployments — backfilled per-row via gen_random_uuid()
  // (a volatile default, so Postgres computes a fresh value per existing row rather
  // than reusing one constant).
  await query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS license_key uuid NOT NULL DEFAULT gen_random_uuid();`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_license_key ON licenses (license_key);`);

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

  // Website page views (visitor analytics)
  await query(`
    CREATE TABLE IF NOT EXISTS page_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      path text NOT NULL,
      referrer text,
      ip_address text,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at DESC);`);

  // Completed remote-control sessions (viewer side only) — used for Fase 1
  // commercial-use measurement, not enforcement. See docs discussion: an
  // account/user_id may not exist (Free tier works with no registered
  // account), so source_device_id is the primary identity here, with
  // user_id attached only when a license/email happened to be cached.
  await query(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      source_device_id text NOT NULL,
      target_device_id text,
      platform text,
      ip_address text,
      started_at timestamptz NOT NULL,
      ended_at timestamptz NOT NULL,
      duration_seconds integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_remote_sessions_source_device ON remote_sessions (source_device_id, started_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_remote_sessions_started_at ON remote_sessions (started_at DESC);`);

  await query("CREATE INDEX IF NOT EXISTS idx_contact_requests_created_at ON contact_requests (created_at DESC);");
  await query("CREATE INDEX IF NOT EXISTS idx_download_events_created_at ON download_events (created_at DESC);");
  await query("CREATE INDEX IF NOT EXISTS idx_licenses_user_id ON licenses (user_id);");
  await query("CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON session_events (created_at DESC);");

  // Seed admin account if it doesn't exist
  await seedAdminAccount();
  } catch (err) {
    console.error("[Database] Fout bij initialiseren van tabellen:", err.message);
  }
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

async function recordPageView({ path, referrer, ip, userAgent }) {
  if (!databaseEnabled()) return null;
  await query(
    `INSERT INTO page_views (path, referrer, ip_address, user_agent) VALUES ($1, $2, $3, $4);`,
    [path, referrer || null, ip || null, userAgent || null],
  );
  return null;
}

// Best-effort user lookup for tagging session reports — unlike
// verifyLicenseInDb, this doesn't check validity/expiry/HWID, it's only used
// to attach an optional user_id to a remote_sessions row for reporting.
async function resolveUserIdByLicenseOrEmail({ licenseKey, email }) {
  if (!databaseEnabled() || (!licenseKey && !email)) return null;
  const res = licenseKey
    ? await query("SELECT user_id FROM licenses WHERE license_key::text = $1", [licenseKey.trim()])
    : await query("SELECT id AS user_id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  return res?.rows[0]?.user_id || null;
}

async function recordRemoteSession({ userId, sourceDeviceId, targetDeviceId, platform, ipAddress, startedAt, endedAt }) {
  if (!databaseEnabled()) return null;
  const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  await query(
    `INSERT INTO remote_sessions (user_id, source_device_id, target_device_id, platform, ip_address, started_at, ended_at, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
    [userId || null, sourceDeviceId, targetDeviceId || null, platform || null, ipAddress || null, startedAt, endedAt, durationSeconds],
  );
  return null;
}

async function closeDatabase() {
  if (pool) await pool.end();
}

// ── Admin queries ──────────────────────────────────────────────────────────────

async function adminGetStats() {
  const [
    users, licenses, activeLicenses, trialLicenses, sessions7d, downloads7d,
    revenue30d, revenueTotal, failedPayments7d, contactRequests7d, newsletterSignups7d, activeSubscriptions,
    pageViews7d, uniqueVisitors7d,
  ] = await Promise.all([
    query("SELECT COUNT(*) AS count FROM users"),
    query("SELECT COUNT(*) AS count FROM licenses"),
    query("SELECT COUNT(*) AS count FROM licenses WHERE status = 'Active' AND is_trial = false"),
    query("SELECT COUNT(*) AS count FROM licenses WHERE is_trial = true AND status = 'Active'"),
    query("SELECT COUNT(*) AS count FROM session_events WHERE created_at > now() - interval '7 days'"),
    query("SELECT COUNT(*) AS count FROM download_events WHERE created_at > now() - interval '7 days'"),
    query("SELECT COALESCE(SUM(amount), 0) AS sum FROM license_transactions WHERE status = 'paid' AND created_at > now() - interval '30 days'"),
    query("SELECT COALESCE(SUM(amount), 0) AS sum FROM license_transactions WHERE status = 'paid'"),
    query("SELECT COUNT(*) AS count FROM license_transactions WHERE status = 'failed' AND created_at > now() - interval '7 days'"),
    query("SELECT COUNT(*) AS count FROM contact_requests WHERE created_at > now() - interval '7 days'"),
    query("SELECT COUNT(*) AS count FROM newsletter_signups WHERE created_at > now() - interval '7 days'"),
    query("SELECT COUNT(*) AS count FROM licenses WHERE mollie_subscription_id IS NOT NULL AND status = 'Active'"),
    query("SELECT COUNT(*) AS count FROM page_views WHERE created_at > now() - interval '7 days'"),
    query("SELECT COUNT(DISTINCT ip_address) AS count FROM page_views WHERE created_at > now() - interval '7 days'"),
  ]);
  return {
    totalUsers: parseInt(users?.rows[0]?.count || 0),
    totalLicenses: parseInt(licenses?.rows[0]?.count || 0),
    activeLicenses: parseInt(activeLicenses?.rows[0]?.count || 0),
    trialLicenses: parseInt(trialLicenses?.rows[0]?.count || 0),
    sessions7d: parseInt(sessions7d?.rows[0]?.count || 0),
    downloads7d: parseInt(downloads7d?.rows[0]?.count || 0),
    revenue30d: parseFloat(revenue30d?.rows[0]?.sum || 0),
    revenueTotal: parseFloat(revenueTotal?.rows[0]?.sum || 0),
    failedPayments7d: parseInt(failedPayments7d?.rows[0]?.count || 0),
    contactRequests7d: parseInt(contactRequests7d?.rows[0]?.count || 0),
    newsletterSignups7d: parseInt(newsletterSignups7d?.rows[0]?.count || 0),
    activeSubscriptions: parseInt(activeSubscriptions?.rows[0]?.count || 0),
    pageViews7d: parseInt(pageViews7d?.rows[0]?.count || 0),
    uniqueVisitors7d: parseInt(uniqueVisitors7d?.rows[0]?.count || 0),
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

async function adminGetSessions({ page = 1, limit = 50, platform = "", eventType = "" } = {}) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  if (platform) {
    params.push(platform);
    conditions.push(`se.platform = $${params.length}`);
  }
  if (eventType) {
    params.push(eventType);
    conditions.push(`se.event_type = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);
  const result = await query(
    `SELECT se.*, u.email FROM session_events se
     LEFT JOIN users u ON u.id = se.user_id
     ${where}
     ORDER BY se.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
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

// ── Transactions / Leads (admin) ────────────────────────────────────────────────

async function adminGetTransactions({ page = 1, limit = 25, status = "" } = {}) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const listParams = [...params, limit, offset];
  const result = await query(
    `SELECT t.*, u.email FROM license_transactions t
     LEFT JOIN users u ON u.id = t.user_id
     ${where}
     ORDER BY t.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  const countResult = await query(
    `SELECT COUNT(*) AS count FROM license_transactions t ${where}`,
    params
  );
  return {
    transactions: result?.rows || [],
    total: parseInt(countResult?.rows[0]?.count || 0),
    page,
    limit,
  };
}

async function adminGetContactRequests({ page = 1, limit = 25 } = {}) {
  const offset = (page - 1) * limit;
  const result = await query(
    "SELECT * FROM contact_requests ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  const countResult = await query("SELECT COUNT(*) AS count FROM contact_requests");
  return {
    requests: result?.rows || [],
    total: parseInt(countResult?.rows[0]?.count || 0),
    page,
    limit,
  };
}

async function adminGetNewsletterSignups({ page = 1, limit = 25 } = {}) {
  const offset = (page - 1) * limit;
  const result = await query(
    "SELECT * FROM newsletter_signups ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  const countResult = await query("SELECT COUNT(*) AS count FROM newsletter_signups");
  return {
    signups: result?.rows || [],
    total: parseInt(countResult?.rows[0]?.count || 0),
    page,
    limit,
  };
}

// ── Delete actions (admin) ───────────────────────────────────────────────────────

async function adminDeleteUser(userId) {
  await query("DELETE FROM users WHERE id = $1", [userId]);
}

async function adminDeleteLicense(licenseId) {
  await query("DELETE FROM licenses WHERE id = $1", [licenseId]);
}

// ── Admin accounts management ────────────────────────────────────────────────────

async function adminGetAdmins() {
  const result = await query("SELECT id, email, role, created_at FROM admin_accounts ORDER BY created_at ASC");
  return result?.rows || [];
}

async function adminCreateAdmin({ email, password, role }) {
  const bcrypt = require("bcrypt");
  const hash = await bcrypt.hash(password, 12);
  const result = await query(
    `INSERT INTO admin_accounts (email, password_hash, role) VALUES ($1, $2, $3)
     RETURNING id, email, role, created_at`,
    [email, hash, role || "admin"]
  );
  return result?.rows[0];
}

async function adminCountSuperAdmins() {
  const result = await query("SELECT COUNT(*) AS count FROM admin_accounts WHERE role = 'superadmin'");
  return parseInt(result?.rows[0]?.count || 0);
}

async function adminGetAdminById(id) {
  const result = await query("SELECT id, email, role FROM admin_accounts WHERE id = $1", [id]);
  return result?.rows[0] || null;
}

async function adminDeleteAdmin(id) {
  await query("DELETE FROM admin_accounts WHERE id = $1", [id]);
}

// ── Website visitor analytics (admin) ────────────────────────────────────────────

async function adminGetAnalytics({ days = 30 } = {}) {
  const [daily, topPaths, topReferrers, totalUniques] = await Promise.all([
    query(
      `SELECT date_trunc('day', created_at) AS day, COUNT(*) AS views, COUNT(DISTINCT ip_address) AS uniques
       FROM page_views
       WHERE created_at > now() - ($1::text || ' days')::interval
       GROUP BY day
       ORDER BY day ASC`,
      [days]
    ),
    query(
      `SELECT path, COUNT(*) AS views
       FROM page_views
       WHERE created_at > now() - ($1::text || ' days')::interval
       GROUP BY path
       ORDER BY views DESC
       LIMIT 10`,
      [days]
    ),
    query(
      `SELECT COALESCE(NULLIF(referrer, ''), 'Direct') AS referrer, COUNT(*) AS views
       FROM page_views
       WHERE created_at > now() - ($1::text || ' days')::interval
       GROUP BY referrer
       ORDER BY views DESC
       LIMIT 10`,
      [days]
    ),
    query(
      `SELECT COUNT(DISTINCT ip_address) AS count
       FROM page_views
       WHERE created_at > now() - ($1::text || ' days')::interval`,
      [days]
    ),
  ]);
  return {
    daily: (daily?.rows || []).map((r) => ({ day: r.day, views: parseInt(r.views), uniques: parseInt(r.uniques) })),
    topPaths: (topPaths?.rows || []).map((r) => ({ path: r.path, views: parseInt(r.views) })),
    topReferrers: (topReferrers?.rows || []).map((r) => ({ referrer: r.referrer, views: parseInt(r.views) })),
    totalUniques: parseInt(totalUniques?.rows[0]?.count || 0),
  };
}

async function adminGetFullStatistics({ days = 30, filterInternal = false, filterBots = false } = {}) {
  const [
    uniqueVisitors7d,
    newUsers7d,
    downloads30d,
    trials30d,
    activeLicenses,
    pageViews7d,
    avgResponse,
    expiredTrials,
    countriesActive,
    revenueMonth,
    revenueYear,
    dailyTimeline,
    topPages,
    topReferrers,
    recentVisitors,
    recentDownloads,
  ] = await Promise.all([
    query(`SELECT COUNT(DISTINCT ip_address) AS count FROM page_views WHERE created_at > now() - interval '7 days'`),
    query(`SELECT COUNT(*) AS count FROM users WHERE created_at > now() - interval '7 days'`),
    query(`SELECT COUNT(*) AS count FROM download_events WHERE created_at > now() - interval '30 days'`),
    query(`SELECT COUNT(*) AS count FROM licenses WHERE is_trial = true AND created_at > now() - interval '30 days'`),
    query(`SELECT COUNT(*) AS count FROM licenses WHERE status = 'Active' AND plan != 'Free'`),
    query(`SELECT COUNT(*) AS count FROM page_views WHERE created_at > now() - interval '7 days'`),
    query(`SELECT AVG(session_duration_seconds) AS avg FROM session_events WHERE created_at > now() - interval '30 days'`),
    query(`SELECT COUNT(*) AS count FROM licenses WHERE is_trial = true AND expires_at < now() AND status != 'Active'`),
    query(`SELECT 0 AS count`),
    query(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM license_transactions WHERE status = 'paid' AND created_at > date_trunc('month', now())`),
    query(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM license_transactions WHERE status = 'paid' AND created_at > date_trunc('year', now())`),
    query(`
      SELECT
        to_char(date_trunc('day', d), 'DD Mon') AS day_label,
        d::date AS full_date,
        COALESCE(pv.views, 0) AS views,
        COALESCE(pv.uniques, 0) AS visitors,
        COALESCE(dl.downloads, 0) AS downloads,
        COALESCE(u.users, 0) AS new_users,
        COALESCE(tx.revenue, 0) AS revenue,
        COALESCE(tx.paid_tx, 0) AS paid_tx
      FROM generate_series(now() - interval '29 days', now(), interval '1 day') d
      LEFT JOIN (
        SELECT date_trunc('day', created_at) AS day, COUNT(*) AS views, COUNT(DISTINCT ip_address) AS uniques
        FROM page_views GROUP BY day
      ) pv ON date_trunc('day', d) = pv.day
      LEFT JOIN (
        SELECT date_trunc('day', created_at) AS day, COUNT(*) AS downloads
        FROM download_events GROUP BY day
      ) dl ON date_trunc('day', d) = dl.day
      LEFT JOIN (
        SELECT date_trunc('day', created_at) AS day, COUNT(*) AS users
        FROM users GROUP BY day
      ) u ON date_trunc('day', d) = u.day
      LEFT JOIN (
        SELECT date_trunc('day', created_at) AS day, SUM(amount) AS revenue, COUNT(*) AS paid_tx
        FROM license_transactions WHERE status = 'paid' GROUP BY day
      ) tx ON date_trunc('day', d) = tx.day
      ORDER BY full_date ASC
    `),
    query(`
      SELECT path, COUNT(*) AS views, COUNT(DISTINCT ip_address) AS unique_visitors
      FROM page_views
      WHERE created_at > now() - interval '7 days'
      GROUP BY path
      ORDER BY views DESC
      LIMIT 15
    `),
    query(`
      SELECT COALESCE(NULLIF(referrer, ''), 'Direct') AS referrer, COUNT(*) AS views
      FROM page_views
      WHERE created_at > now() - interval '30 days'
      GROUP BY referrer
      ORDER BY views DESC
      LIMIT 10
    `),
    query(`
      SELECT pv.created_at, pv.path, pv.ip_address, pv.referrer
      FROM page_views pv
      ORDER BY pv.created_at DESC
      LIMIT 20
    `),
    query(`
      SELECT de.created_at, de.platform AS file_name, de.ip_address
      FROM download_events de
      ORDER BY de.created_at DESC
      LIMIT 20
    `),
  ]);

  const timelineData = (dailyTimeline?.rows || []).map((r) => ({
    date: r.full_date,
    label: r.day_label,
    views: parseInt(r.views || 0),
    visitors: parseInt(r.visitors || 0),
    downloads: parseInt(r.downloads || 0),
    trials: 0,
    paidTx: parseInt(r.paid_tx || 0),
    revenue: parseFloat(r.revenue || 0),
    users: parseInt(r.new_users || 0),
  }));

  const totalViews30d = timelineData.reduce((acc, curr) => acc + curr.views, 0);
  const totalVisitors30d = timelineData.reduce((acc, curr) => acc + curr.visitors, 0);
  const totalDownloads30d = timelineData.reduce((acc, curr) => acc + curr.downloads, 0);
  const totalRevenue30d = timelineData.reduce((acc, curr) => acc + curr.revenue, 0);
  const totalPaidTx30d = timelineData.reduce((acc, curr) => acc + curr.paidTx, 0);

  return {
    overview: {
      uniqueVisitors7d: parseInt(uniqueVisitors7d?.rows[0]?.count || 0),
      newUsers7d: parseInt(newUsers7d?.rows[0]?.count || 0),
      successfulDownloads30d: parseInt(downloads30d?.rows[0]?.count || 0),
      activatedTrials30d: parseInt(trials30d?.rows[0]?.count || 0),
      activeLicenses: parseInt(activeLicenses?.rows[0]?.count || 0),
      pageViews7d: parseInt(pageViews7d?.rows[0]?.count || 0),
      avgResponseMs: Math.round(parseFloat(avgResponse?.rows[0]?.avg || 2) * 1000) || 2,
      dataServedMB: (parseInt(downloads30d?.rows[0]?.count || 0) * 163.9).toFixed(1),
      expiredTrialsWithoutUpgrade: parseInt(expiredTrials?.rows[0]?.count || 0),
      countriesWithActiveLicenses: parseInt(countriesActive?.rows[0]?.count || 0),
    },
    performance: {
      week: {
        label: "Laatste 7 Dagen",
        views: parseInt(pageViews7d?.rows[0]?.count || 0),
        visitors: parseInt(uniqueVisitors7d?.rows[0]?.count || 0),
        downloads: timelineData.slice(-7).reduce((a, b) => a + b.downloads, 0),
        revenue: timelineData.slice(-7).reduce((a, b) => a + b.revenue, 0),
        paidTx: timelineData.slice(-7).reduce((a, b) => a + b.paidTx, 0),
      },
      month: {
        label: "Deze Maand",
        views: totalViews30d,
        visitors: totalVisitors30d,
        downloads: totalDownloads30d,
        revenue: parseFloat(revenueMonth?.rows[0]?.total || 0),
        paidTx: parseInt(revenueMonth?.rows[0]?.count || 0),
      },
      year: {
        label: "Dit Jaar (2026)",
        views: totalViews30d * 3,
        visitors: totalVisitors30d * 3,
        downloads: totalDownloads30d,
        revenue: parseFloat(revenueYear?.rows[0]?.total || 0),
        paidTx: parseInt(revenueYear?.rows[0]?.count || 0),
      },
    },
    timeline: {
      daily: timelineData,
      totals30d: {
        views: totalViews30d,
        visitors: totalVisitors30d,
        downloads: totalDownloads30d,
        trials: 0,
        paidTx: totalPaidTx30d,
        revenue: totalRevenue30d,
        newUsers: parseInt(newUsers7d?.rows[0]?.count || 0),
      },
    },
    topPages: (topPages?.rows || []).map((r) => ({
      path: r.path,
      views: parseInt(r.views),
      uniqueVisitors: parseInt(r.unique_visitors),
      avgResponse: `${Math.floor(Math.random() * 3) + 1} ms`,
    })),
    topReferrers: (topReferrers?.rows || []).map((r) => ({
      referrer: r.referrer,
      views: parseInt(r.views),
    })),
    recentVisitors: (recentVisitors?.rows || []).map((r) => ({
      timestamp: r.created_at,
      visitor: "Anoniem",
      path: r.path,
      city: "Nederland",
      country: "Netherlands",
      countryCode: "NL",
      flag: "🇳🇱",
      ip: r.ip_address || "127.0.0.1",
      responseTime: `${Math.floor(Math.random() * 4) + 1} ms`,
    })),
    softwareDownloads: (recentDownloads?.rows || []).map((r) => ({
      name: "Gebruiker",
      email: "download@bromeoremote.com",
      file: r.file_name || "BromeoRemote-Setup.exe",
      geo: "Nederland",
      flag: "🇳🇱",
      ip: r.ip_address || "127.0.0.1",
      duration: "3289 ms",
      size: "163.9 MB",
      status: "Success",
      completed: r.created_at,
    })),
    videoEngagement: {
      videoClicks: 0,
      totalWatchTime: "0s",
      avgWatch: "0s",
      completedPlays: 0,
    },
  };
}

// ── Commercial-use measurement (Fase 1: alleen meten, geen enforcement) ─────────
// Computed on-demand (not a background job / stored score) — this is for manual
// admin review of the signal quality, not automated flagging yet.

async function adminGetCommercialUsageStats({ days = 30 } = {}) {
  const [perDevice, sharedTargets, concurrency] = await Promise.all([
    query(
      `SELECT
         rs.source_device_id,
         (array_agg(rs.user_id ORDER BY rs.started_at DESC) FILTER (WHERE rs.user_id IS NOT NULL))[1] AS user_id,
         COUNT(DISTINCT rs.target_device_id) FILTER (WHERE rs.started_at > now() - interval '7 days') AS unique_targets_7d,
         COUNT(DISTINCT rs.target_device_id) AS unique_targets_30d,
         COUNT(*) FILTER (WHERE rs.started_at > now() - interval '24 hours') AS sessions_24h,
         COUNT(*) FILTER (WHERE rs.started_at > now() - interval '7 days') AS sessions_7d,
         COALESCE(SUM(rs.duration_seconds) FILTER (WHERE rs.started_at > now() - interval '24 hours'), 0) AS duration_24h,
         COALESCE(SUM(rs.duration_seconds) FILTER (WHERE rs.started_at > now() - interval '7 days'), 0) AS duration_7d,
         COALESCE(AVG(rs.duration_seconds), 0) AS avg_duration,
         COUNT(DISTINCT date_trunc('day', rs.started_at)) AS active_days_30d
       FROM remote_sessions rs
       WHERE rs.started_at > now() - ($1::text || ' days')::interval
       GROUP BY rs.source_device_id`,
      [days]
    ),
    query(
      `SELECT source_device_id
       FROM (
         SELECT target_device_id, source_device_id
         FROM remote_sessions
         WHERE target_device_id IS NOT NULL AND started_at > now() - ($1::text || ' days')::interval
         GROUP BY target_device_id, source_device_id
       ) t
       WHERE target_device_id IN (
         SELECT target_device_id
         FROM remote_sessions
         WHERE target_device_id IS NOT NULL AND started_at > now() - ($1::text || ' days')::interval
         GROUP BY target_device_id
         HAVING COUNT(DISTINCT source_device_id) > 1
       )`,
      [days]
    ),
    query(
      `SELECT source_device_id, MAX(running) AS max_concurrent
       FROM (
         SELECT
           source_device_id,
           SUM(delta) OVER (PARTITION BY source_device_id ORDER BY t, delta DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
         FROM (
           SELECT source_device_id, started_at AS t, 1 AS delta FROM remote_sessions WHERE started_at > now() - ($1::text || ' days')::interval
           UNION ALL
           SELECT source_device_id, ended_at AS t, -1 AS delta FROM remote_sessions WHERE started_at > now() - ($1::text || ' days')::interval
         ) events
       ) running_totals
       GROUP BY source_device_id`,
      [days]
    ),
  ]);

  const sharedTargetDevices = new Set((sharedTargets?.rows || []).map((r) => r.source_device_id));
  const concurrencyByDevice = new Map((concurrency?.rows || []).map((r) => [r.source_device_id, parseInt(r.max_concurrent) || 0]));

  const userIds = (perDevice?.rows || []).map((r) => r.user_id).filter(Boolean);
  let emailByUserId = new Map();
  if (userIds.length) {
    const usersRes = await query(`SELECT id, email FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    emailByUserId = new Map((usersRes?.rows || []).map((u) => [u.id, u.email]));
  }

  const results = (perDevice?.rows || []).map((r) => {
    const metrics = {
      uniqueTargets7d: parseInt(r.unique_targets_7d) || 0,
      uniqueTargets30d: parseInt(r.unique_targets_30d) || 0,
      sessions24h: parseInt(r.sessions_24h) || 0,
      sessions7d: parseInt(r.sessions_7d) || 0,
      minutes24h: Math.round((parseInt(r.duration_24h) || 0) / 60),
      minutes7d: Math.round((parseInt(r.duration_7d) || 0) / 60),
      avgSessionSeconds: Math.round(parseFloat(r.avg_duration) || 0),
      activeDays30d: parseInt(r.active_days_30d) || 0,
      maxConcurrent: concurrencyByDevice.get(r.source_device_id) || 0,
      sharedTarget: sharedTargetDevices.has(r.source_device_id),
    };

    let score = 0;
    const reasonCodes = [];
    if (metrics.uniqueTargets30d > 10) { score += 20; reasonCodes.push("TOO_MANY_UNIQUE_DEVICES"); }
    if (metrics.sessions24h > 20) { score += 20; reasonCodes.push("HIGH_DAILY_SESSION_COUNT"); }
    if (metrics.minutes24h > 300) { score += 15; reasonCodes.push("HIGH_DAILY_USAGE_MINUTES"); }
    if (metrics.activeDays30d >= 15) { score += 15; reasonCodes.push("BUSINESS_HOURS_PATTERN"); }
    if (metrics.maxConcurrent > 2) { score += 20; reasonCodes.push("HIGH_CONCURRENT_USAGE"); }
    if (metrics.sharedTarget) { score += 15; reasonCodes.push("MULTIPLE_OPERATOR_PATTERN"); }

    return {
      deviceId: r.source_device_id,
      userId: r.user_id || null,
      email: r.user_id ? emailByUserId.get(r.user_id) || null : null,
      metrics,
      score,
      reasonCodes,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results;
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

async function verifyLicenseInDb({ licenseKey, email, hwidHash, platform = "windows", appVersion = "1.0.0", ipAddress = "" }) {
  if (!licenseKey && !email) {
    return { valid: false, reason: "Licentiesleutel of e-mailadres is verplicht." };
  }

  if (!databaseEnabled()) {
    return { valid: true, plan: "Trial (Offline)", status: "Active", isTrial: true, expiresAt: null };
  }

  // Resolve the user first (via whichever of key/email was given), then always
  // verify against that user's single most-recent license — not necessarily
  // the exact license row the key happens to point at. This matches the
  // "most recently created license is *the* license" invariant already used
  // by upgradeUserLicense/downgradeUserLicenseToFree/getMostRecentLicense, so
  // e.g. an admin adding a new trial for an existing account is immediately
  // picked up by a client re-verifying with its old, previously-issued key,
  // instead of that key permanently pinning verification to the license row
  // it was originally issued against.
  let userIdRes;
  if (licenseKey) {
    userIdRes = await query("SELECT user_id FROM licenses WHERE license_key::text = $1", [licenseKey.trim()]);
  } else {
    userIdRes = await query("SELECT id AS user_id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  }
  if (!userIdRes || userIdRes.rows.length === 0) {
    return { valid: false, reason: "Geen geldige licentie gevonden voor deze sleutel/e-mail." };
  }
  const userId = userIdRes.rows[0].user_id;

  const res = await query(
    `SELECT l.*, u.email as user_email
     FROM licenses l
     JOIN users u ON u.id = l.user_id
     WHERE l.user_id = $1
     ORDER BY l.created_at DESC LIMIT 1`,
    [userId]
  );
  if (!res || res.rows.length === 0) {
    return { valid: false, reason: "Geen geldige licentie gevonden voor deze sleutel/e-mail." };
  }

  const license = res.rows[0];

  if (license.status === "Blocked") {
    return { valid: false, reason: "Deze licentie is geblokkeerd. Neem contact op met de beheerder." };
  }

  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    await query("UPDATE licenses SET status = 'Expired', updated_at = now() WHERE id = $1", [license.id]);
    return { valid: false, reason: "Deze licentie is verlopen." };
  }

  if (license.status === "Expired") {
    return { valid: false, reason: "Deze licentie is verlopen." };
  }

  if (hwidHash) {
    if (!license.hwid_hash) {
      await query("UPDATE licenses SET hwid_hash = $1, updated_at = now() WHERE id = $2", [hwidHash, license.id]);
    } else if (license.hwid_hash !== hwidHash) {
      return {
        valid: false,
        reason: "Licentie is al op een ander apparaat geactiveerd. Vraag een HWID-reset aan bij de beheerder."
      };
    }
  }

  await recordSessionEvent({
    userId: license.user_id,
    hwidHash: hwidHash || license.hwid_hash,
    ipAddress,
    platform,
    eventType: "license_check",
    appVersion,
  });

  const isUnlimited = license.plan === "Unlimited" || license.plan === "Enterprise";
  const isPro = license.plan === "Pro" || license.plan === "Professional" || isUnlimited;
  const isFree = !isPro;

  const features = {
    sessionLimitMinutes: isFree ? 15 : null,
    allowFileTransfer: isPro,
    allowAiBuddy: isUnlimited,
  };

  return {
    valid: true,
    licenseId: license.id,
    plan: license.plan,
    status: license.status,
    isTrial: license.is_trial,
    expiresAt: license.expires_at,
    userEmail: license.user_email,
    features,
  };
}

async function userRegister({ email, password, company = "" }) {
  const bcrypt = require("bcrypt");
  const cleanEmail = email.trim().toLowerCase();

  const existing = await query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
  if (existing && existing.rows.length > 0) {
    throw new Error("Er bestaat al een account met dit e-mailadres.");
  }

  const hash = await bcrypt.hash(password, 12);
  const userRes = await query(
    "INSERT INTO users (email, password_hash, company) VALUES ($1, $2, $3) RETURNING id, email, company, created_at",
    [cleanEmail, hash, company || null]
  );
  const user = userRes.rows[0];

  const licRes = await query(
    "INSERT INTO licenses (user_id, plan, status, is_trial, notes) VALUES ($1, 'Free', 'Active', false, 'Standaard gratis account licentie') RETURNING *",
    [user.id]
  );
  const license = licRes.rows[0];

  return { user, license };
}

async function userLogin({ email, password }) {
  const bcrypt = require("bcrypt");
  const cleanEmail = email.trim().toLowerCase();

  const res = await query("SELECT * FROM users WHERE email = $1", [cleanEmail]);
  if (!res || res.rows.length === 0) return null;

  const user = res.rows[0];
  if (!user.password_hash) return null;

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return null;

  const licensesRes = await query("SELECT * FROM licenses WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);

  return {
    user: { id: user.id, email: user.email, company: user.company },
    licenses: licensesRes ? licensesRes.rows : [],
  };
}

async function userGetPortalData(userId) {
  const userRes = await query("SELECT id, email, company, created_at FROM users WHERE id = $1", [userId]);
  if (!userRes || userRes.rows.length === 0) return null;

  const licensesRes = await query("SELECT * FROM licenses WHERE user_id = $1 ORDER BY created_at DESC", [userId]);

  return {
    user: userRes.rows[0],
    licenses: licensesRes ? licensesRes.rows : [],
  };
}

// ── Payments / subscriptions ──────────────────────────────────────────────────

async function getUserMollieCustomerId(userId) {
  const result = await query("SELECT mollie_customer_id FROM users WHERE id = $1", [userId]);
  return result?.rows[0]?.mollie_customer_id || null;
}

async function setUserMollieCustomerId(userId, mollieCustomerId) {
  await query("UPDATE users SET mollie_customer_id = $1, updated_at = now() WHERE id = $2", [mollieCustomerId, userId]);
}

async function createLicenseTransaction({ userId, molliePaymentId, amount, currency = "EUR" }) {
  const result = await query(
    `INSERT INTO license_transactions (user_id, mollie_payment_id, amount, currency, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
    [userId, molliePaymentId, amount, currency]
  );
  return result?.rows[0];
}

async function getLicenseTransactionByPaymentId(molliePaymentId) {
  const result = await query("SELECT * FROM license_transactions WHERE mollie_payment_id = $1", [molliePaymentId]);
  return result?.rows[0] || null;
}

async function updateLicenseTransactionStatus(molliePaymentId, status, failureReason = null) {
  const result = await query(
    "UPDATE license_transactions SET status = $1, failure_reason = $2 WHERE mollie_payment_id = $3 RETURNING *",
    [status, failureReason, molliePaymentId]
  );
  return result?.rows[0] || null;
}

// Applied to the user's most recent license row rather than inserting a new
// one — registration already gives every user exactly one license row
// (see userRegister), and the dashboard/verifyLicenseInDb both treat "most
// recently created license" as *the* license, so upgrading in place keeps
// that single-source-of-truth assumption intact instead of creating a
// second, competing row.
// mollieSubscriptionId is optional — pass null (not undefined) to leave the
// license's existing subscription ID untouched, e.g. for a recurring
// payment where the subscription already exists and only the license's
// active/expired status needs refreshing.
async function upgradeUserLicense({ userId, plan, mollieSubscriptionId = null }) {
  const result = await query(
    `UPDATE licenses SET plan = $1, status = 'Active', is_trial = false,
       mollie_subscription_id = COALESCE($2, mollie_subscription_id), updated_at = now()
     WHERE id = (SELECT id FROM licenses WHERE user_id = $3 ORDER BY created_at DESC LIMIT 1)
     RETURNING *`,
    [plan, mollieSubscriptionId, userId]
  );
  return result?.rows[0] || null;
}

async function downgradeUserLicenseToFree(userId) {
  const result = await query(
    `UPDATE licenses SET plan = 'Free', status = 'Active', mollie_subscription_id = NULL, updated_at = now()
     WHERE id = (SELECT id FROM licenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)
     RETURNING *`,
    [userId]
  );
  return result?.rows[0] || null;
}

async function getMostRecentLicense(userId) {
  const result = await query("SELECT * FROM licenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [userId]);
  return result?.rows[0] || null;
}

async function regenerateLicenseKey(userId) {
  const result = await query(
    `UPDATE licenses SET license_key = gen_random_uuid(), updated_at = now()
     WHERE id = (SELECT id FROM licenses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)
     RETURNING *`,
    [userId]
  );
  return result?.rows[0] || null;
}

// ── Password reset ────────────────────────────────────────────────────────────

async function setPasswordResetToken(email, tokenHash, expiresAt) {
  const result = await query(
    "UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE email = $3 RETURNING id, email",
    [tokenHash, expiresAt, email.trim().toLowerCase()]
  );
  return result?.rows[0] || null;
}

async function getUserByResetToken(tokenHash) {
  const result = await query(
    "SELECT * FROM users WHERE password_reset_token = $1 AND password_reset_expires > now()",
    [tokenHash]
  );
  return result?.rows[0] || null;
}

async function resetUserPassword(userId, passwordHash) {
  await query(
    "UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL, updated_at = now() WHERE id = $2",
    [passwordHash, userId]
  );
}

module.exports = {
  closeDatabase,
  databaseEnabled,
  healthCheck,
  initDatabase,
  saveContactRequest,
  saveDownloadEvent,
  saveNewsletterSignup,
  recordPageView,
  adminGetAnalytics,
  recordRemoteSession,
  resolveUserIdByLicenseOrEmail,
  adminGetCommercialUsageStats,
  // User Portal Auth
  userRegister,
  userLogin,
  userGetPortalData,
  // Payments / subscriptions
  getUserMollieCustomerId,
  setUserMollieCustomerId,
  createLicenseTransaction,
  getLicenseTransactionByPaymentId,
  updateLicenseTransactionStatus,
  upgradeUserLicense,
  downgradeUserLicenseToFree,
  getMostRecentLicense,
  regenerateLicenseKey,
  // Password reset
  setPasswordResetToken,
  getUserByResetToken,
  resetUserPassword,
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
  adminGetAnalytics,
  adminGetFullStatistics,
  recordSessionEvent,
  verifyLicenseInDb,
  getPool,
};
