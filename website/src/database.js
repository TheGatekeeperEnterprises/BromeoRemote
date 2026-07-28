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

async function verifyLicenseInDb({ licenseKey, email, hwidHash, platform = "windows", appVersion = "1.0.0", ipAddress = "" }) {
  if (!licenseKey && !email) {
    return { valid: false, reason: "Licentiesleutel of e-mailadres is verplicht." };
  }

  if (!databaseEnabled()) {
    return { valid: true, plan: "Trial (Offline)", status: "Active", isTrial: true, expiresAt: null };
  }

  let queryText = `
    SELECT l.*, u.email as user_email
    FROM licenses l
    JOIN users u ON u.id = l.user_id
    WHERE 
  `;
  const params = [];

  if (licenseKey) {
    queryText += ` l.license_key::text = $1`;
    params.push(licenseKey.trim());
  } else {
    queryText += ` u.email = $1`;
    params.push(email.trim().toLowerCase());
  }

  queryText += ` ORDER BY l.created_at DESC LIMIT 1`;

  const res = await query(queryText, params);
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
  recordSessionEvent,
  verifyLicenseInDb,
  getPool,
};
