-- One-off backfill for the "paid subscriptions show no expiry date" bug.
--
-- Before the fix in website/src/database.js's upgradeUserLicense(), every
-- successful Mollie payment (first purchase and every renewal) left
-- licenses.expires_at as NULL instead of setting it to one month past the
-- payment. Any account that upgraded/renewed before that fix was deployed
-- is stuck showing "-" in the admin panel and won't self-heal until its
-- *next* renewal webhook fires (up to a month away).
--
-- This finds every such account and sets expires_at to their most recent
-- 'paid' transaction + 1 month, exactly matching what the fixed code would
-- have set at the time. Scoped tightly on purpose:
--   - plan IN ('Pro','Unlimited')   -> only paid plans, never touches Free
--   - status = 'Active'             -> never resurrects an already-Expired/
--                                       Blocked license
--   - source = 'Checkout'           -> only Mollie-driven licenses, never an
--                                       AdminCreated one (those have their own
--                                       admin-controlled expiry, if any)
--   - mollie_subscription_id IS NOT NULL -> only real, ongoing subscriptions
--   - expires_at IS NULL            -> only rows this bug actually affected;
--                                       re-running this script is a no-op
--   - only the user's most-recently-created license row -> matches the
--     "most recent license = the license" invariant used everywhere else
--     in this codebase (see upgradeUserLicense's own comment)
--
-- Run the SELECT first and eyeball the results before running the UPDATE.

-- ── 1. Preview — run this first, review the rows ───────────────────────────
SELECT
  l.id                AS license_id,
  u.email,
  l.plan,
  l.status,
  l.expires_at        AS current_expires_at,
  lt.last_paid_at,
  lt.last_paid_at + interval '1 month' AS new_expires_at
FROM licenses l
JOIN users u ON u.id = l.user_id
JOIN (
  SELECT user_id, MAX(created_at) AS last_paid_at
  FROM license_transactions
  WHERE status = 'paid'
  GROUP BY user_id
) lt ON lt.user_id = l.user_id
WHERE l.plan IN ('Pro', 'Unlimited')
  AND l.status = 'Active'
  AND l.source = 'Checkout'
  AND l.mollie_subscription_id IS NOT NULL
  AND l.expires_at IS NULL
  AND l.id = (
    SELECT id FROM licenses WHERE user_id = l.user_id ORDER BY created_at DESC LIMIT 1
  )
ORDER BY u.email;

-- ── 2. Apply — only run once the preview above looks right ─────────────────
-- UPDATE licenses l
-- SET expires_at = lt.last_paid_at + interval '1 month',
--     updated_at = now()
-- FROM (
--   SELECT user_id, MAX(created_at) AS last_paid_at
--   FROM license_transactions
--   WHERE status = 'paid'
--   GROUP BY user_id
-- ) lt
-- WHERE l.user_id = lt.user_id
--   AND l.plan IN ('Pro', 'Unlimited')
--   AND l.status = 'Active'
--   AND l.source = 'Checkout'
--   AND l.mollie_subscription_id IS NOT NULL
--   AND l.expires_at IS NULL
--   AND l.id = (
--     SELECT id FROM licenses WHERE user_id = l.user_id ORDER BY created_at DESC LIMIT 1
--   )
-- RETURNING l.id, l.user_id, l.plan, l.expires_at;
