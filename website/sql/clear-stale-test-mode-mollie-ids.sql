-- One-off cleanup after switching MOLLIE_API_KEY from a test key to the live
-- key (2026-08-01).
--
-- Mollie customers, payments and subscriptions are scoped per API mode —
-- test-mode data simply doesn't exist under the live key. Every account
-- that ever went through checkout while the test key was active has a
-- users.mollie_customer_id (and possibly licenses.mollie_subscription_id)
-- pointing at a test-mode object, which now 404s with "exists, but the
-- wrong mode is used" (see website/src/licensing.js's createSubscriptionCheckout
-- and cancelUserSubscription — both reuse whatever ID is already stored
-- instead of checking whether it's still valid).
--
-- Fix: clear those stale IDs. createSubscriptionCheckout already creates a
-- fresh Mollie customer whenever mollie_customer_id is empty — no code
-- change needed, this is purely a data reset. Old license_transactions rows
-- referencing test-mode payment IDs are left alone (harmless history, not
-- worth deleting).
--
-- Run the SELECT first and eyeball the results before running the UPDATE.

-- ── 1. Preview — run this first, review the rows ───────────────────────────
SELECT
  u.id             AS user_id,
  u.email,
  u.mollie_customer_id,
  l.id             AS license_id,
  l.plan,
  l.status,
  l.mollie_subscription_id
FROM users u
LEFT JOIN licenses l ON l.id = (
  SELECT id FROM licenses WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
)
WHERE u.mollie_customer_id IS NOT NULL
   OR l.mollie_subscription_id IS NOT NULL
ORDER BY u.email;

-- ── 2. Apply — only run once the preview above looks right ─────────────────
-- Clears every stale customer ID — safe even for someone who genuinely has
-- an active paid plan: their *next* checkout/webhook simply creates a fresh
-- live-mode customer and subscription the same way a brand-new signup
-- would, and downgradeUserLicenseToFree/upgradeUserLicense don't depend on
-- mollie_customer_id at all.

-- UPDATE users SET mollie_customer_id = NULL, updated_at = now()
-- WHERE mollie_customer_id IS NOT NULL
-- RETURNING id, email;

-- UPDATE licenses SET mollie_subscription_id = NULL, updated_at = now()
-- WHERE mollie_subscription_id IS NOT NULL
-- RETURNING id, user_id, plan;
