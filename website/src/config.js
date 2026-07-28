require("dotenv").config();

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : "";
}

const config = {
  env: process.env.NODE_ENV || "development",
  port: numberFromEnv(process.env.PORT, 3000),
  publicBaseUrl: cleanUrl(process.env.PUBLIC_BASE_URL) || "http://localhost:3000",
  databaseUrl: cleanUrl(process.env.DATABASE_URL),
  smtp: {
    host: cleanUrl(process.env.SMTP_HOST),
    port: numberFromEnv(process.env.SMTP_PORT, 465),
    secure: boolFromEnv(process.env.SMTP_SECURE, true),
    user: cleanUrl(process.env.SMTP_USER),
    pass: process.env.SMTP_PASS || "",
    from: cleanUrl(process.env.SMTP_FROM) || cleanUrl(process.env.SMTP_USER),
    to: cleanUrl(process.env.SMTP_TO) || cleanUrl(process.env.SMTP_FROM) || cleanUrl(process.env.SMTP_USER),
  },
  downloads: {
    windows: cleanUrl(process.env.DOWNLOAD_WINDOWS_URL),
    windowsPortable: cleanUrl(process.env.DOWNLOAD_WINDOWS_PORTABLE_URL),
    android: cleanUrl(process.env.DOWNLOAD_ANDROID_URL),
    github: cleanUrl(process.env.DOWNLOAD_GITHUB_URL) || "https://github.com/TheGatekeeperEnterprises/BromeoRemote",
  },
  links: {
    signalingStatus: cleanUrl(process.env.SIGNALING_STATUS_URL),
    docs: cleanUrl(process.env.DOCS_URL),
  },
};

config.mailEnabled = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from);

// Several secrets used to silently fall back to hardcoded defaults (visible
// in this public repo) when their env vars were unset — fine for local dev,
// a real security hole in production. Fail loudly at startup instead of
// quietly running on a known-to-attackers secret/password.
if (config.env === "production") {
  const missing = ["SESSION_SECRET", "USER_SESSION_SECRET", "ADMIN_PASSWORD"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variable(s): ${missing.join(", ")}. ` +
        "Refusing to start with insecure hardcoded defaults — set these in Coolify's environment variables."
    );
  }
}

module.exports = { config };
