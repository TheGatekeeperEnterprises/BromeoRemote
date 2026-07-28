const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { databaseEnabled, getPool } = require("./database");
const { config } = require("./config");

// Deliberately separate from admin.js's createAdminSession() — a customer
// login and an admin login used to share one cookie, one session store
// table, and one secret (since the admin session middleware was mounted
// globally), which meant logging into either one on the same browser could
// stomp on the other's session state. Distinct cookie name, table, and
// secret here keeps the two fully isolated.
function createUserSession() {
  const store = databaseEnabled()
    ? new pgSession({ pool: getPool(), tableName: "user_sessions", createTableIfMissing: true })
    : new session.MemoryStore();

  const sessionMw = session({
    store,
    secret: process.env.USER_SESSION_SECRET || "bromeoremote-user-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      // Customers shouldn't have to re-login every few hours the way an
      // admin session reasonably should — 30 days, refreshed on activity.
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: config.env === "production",
    },
    name: "br_user_sid",
  });

  return (req, res, next) => {
    sessionMw(req, res, (err) => {
      if (err) {
        console.error("[User Session Error]", err.message);
        if (!req.path.startsWith("/api/")) return next();
      }
      next(err);
    });
  };
}

module.exports = { createUserSession };
