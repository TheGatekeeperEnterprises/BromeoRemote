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
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
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

  await query("CREATE INDEX IF NOT EXISTS idx_contact_requests_created_at ON contact_requests (created_at DESC);");
  await query("CREATE INDEX IF NOT EXISTS idx_download_events_created_at ON download_events (created_at DESC);");
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
    `
      INSERT INTO contact_requests (id, name, email, company, subject, message, source, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, 'website', $7, $8);
    `,
    [id, contact.name, contact.email, contact.company, contact.subject, contact.message, requestMeta.ip, requestMeta.userAgent],
  );
  return id;
}

async function saveNewsletterSignup(signup, requestMeta) {
  if (!databaseEnabled()) return null;
  const id = crypto.randomUUID();
  await query(
    `
      INSERT INTO newsletter_signups (id, email, source, ip_address, user_agent)
      VALUES ($1, $2, 'website', $3, $4)
      ON CONFLICT (email)
      DO UPDATE SET updated_at = now(), ip_address = EXCLUDED.ip_address, user_agent = EXCLUDED.user_agent;
    `,
    [id, signup.email, requestMeta.ip, requestMeta.userAgent],
  );
  return id;
}

async function saveDownloadEvent(platform, requestMeta) {
  if (!databaseEnabled()) return null;
  const id = crypto.randomUUID();
  await query(
    `
      INSERT INTO download_events (id, platform, ip_address, user_agent)
      VALUES ($1, $2, $3, $4);
    `,
    [id, platform, requestMeta.ip, requestMeta.userAgent],
  );
  return id;
}

async function closeDatabase() {
  if (pool) await pool.end();
}

module.exports = {
  closeDatabase,
  databaseEnabled,
  healthCheck,
  initDatabase,
  saveContactRequest,
  saveDownloadEvent,
  saveNewsletterSignup,
};
