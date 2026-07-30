const crypto = require('crypto');
const { createMollieClient } = require('@mollie/api-client');

// Mollie Client is initialized if an API key is present in the environment
let mollieClient = null;
if (process.env.MOLLIE_API_KEY) {
  mollieClient = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });
}

/**
 * Normalizes the Hardware ID similar to BromeoGrid.Web LicenseDeviceFingerprintProtector.
 * Strips control characters, lowercases, and enforces minimum 16 characters.
 */
function normalizeDeviceId(deviceId) {
  if (!deviceId) return '';
  const trimmed = deviceId.trim();
  let normalized = '';
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    // Include non-control characters
    if (code >= 32 && code !== 127) {
      normalized += trimmed[i];
    }
  }
  normalized = normalized.trim().toLowerCase();
  if (normalized.length > 256) {
    normalized = normalized.slice(0, 256);
  }
  return normalized.length >= 16 ? normalized : '';
}

/**
 * Hashes the normalized device ID using SHA-256 and prefixes it.
 * This ensures the raw HWID is never stored in the database.
 */
function protectForStorage(normalizedDeviceId) {
  if (!normalizedDeviceId) return '';
  const hash = crypto.createHash('sha256').update(normalizedDeviceId, 'utf8').digest('hex').toLowerCase();
  return 'fp1:' + hash;
}

const PLAN_PRICES = {
  Pro: '7.95',
  Unlimited: '50.00',
};

const PLAN_NAMES = {
  Pro: 'Pro (€7,95/mnd)',
  Unlimited: 'Unlimited (€50,00/mnd)',
};

function baseUrl() {
  return process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
}

/**
 * Creates a Mollie checkout session for a new subscription. Reuses the
 * user's existing Mollie customer if they've checked out before (avoids
 * creating a duplicate customer record in Mollie on every upgrade attempt).
 * @param {string} email - The user's email
 * @param {string} userId - The user's database UUID
 * @returns {Promise<string>} The checkout URL
 */
async function createSubscriptionCheckout(email, userId, plan = 'Pro') {
  if (!mollieClient) {
    throw new Error('Mollie is niet geconfigureerd op de server. MOLLIE_API_KEY ontbreekt.');
  }

  const { getUserMollieCustomerId, setUserMollieCustomerId, createLicenseTransaction } = require('./database');

  const amountValue = PLAN_PRICES[plan] || PLAN_PRICES.Pro;
  const planName = PLAN_NAMES[plan] || PLAN_NAMES.Pro;

  let customerId = await getUserMollieCustomerId(userId);
  if (!customerId) {
    const customer = await mollieClient.customers.create({
      name: 'BromeoRemote Gebruiker',
      email,
      metadata: { userId },
    });
    customerId = customer.id;
    await setUserMollieCustomerId(userId, customerId);
  }

  const payment = await mollieClient.payments.create({
    amount: { value: amountValue, currency: 'EUR' },
    customerId,
    sequenceType: 'first',
    description: `BromeoRemote ${planName}`,
    redirectUrl: baseUrl() + '/?payment=success',
    webhookUrl: baseUrl() + '/api/webhooks/mollie',
    metadata: { userId, plan },
  });

  await createLicenseTransaction({ userId, molliePaymentId: payment.id, amount: amountValue, currency: 'EUR' });

  return payment.getCheckoutUrl();
}

/**
 * Called from the /api/webhooks/mollie route with a payment ID. Mollie
 * webhooks carry no verifiable payload — the only trustworthy source of
 * truth is re-fetching the payment from Mollie's API with our own API key,
 * which is what this does before touching anything in the database.
 *
 * Idempotent by mollie_payment_id: if this fires twice for the same
 * already-paid payment (Mollie retries webhooks that don't 200 fast enough,
 * and can also just call it more than once), the subscription-creation step
 * is skipped the second time since the transaction row is already 'paid'.
 */
async function handleMollieWebhook(paymentId) {
  if (!mollieClient) return;
  const {
    getLicenseTransactionByPaymentId,
    updateLicenseTransactionStatus,
    upgradeUserLicense,
  } = require('./database');

  const payment = await mollieClient.payments.get(paymentId);
  const previousTransaction = await getLicenseTransactionByPaymentId(paymentId);
  const alreadyProcessed = previousTransaction?.status === 'paid';

  await updateLicenseTransactionStatus(paymentId, payment.status, payment.status === 'paid' ? null : payment.status);

  if (payment.status !== 'paid') return;

  const userId = payment.metadata?.userId;
  const plan = payment.metadata?.plan;
  if (!userId || !plan) return; // not one of our checkout payments (shouldn't happen, but don't crash on it)

  if (!alreadyProcessed && payment.sequenceType === 'first' && payment.mandateId && payment.customerId) {
    const amountValue = PLAN_PRICES[plan] || PLAN_PRICES.Pro;
    const planName = PLAN_NAMES[plan] || PLAN_NAMES.Pro;
    const subscription = await mollieClient.customerSubscriptions.create({
      customerId: payment.customerId,
      mandateId: payment.mandateId,
      amount: { value: amountValue, currency: 'EUR' },
      interval: '1 month',
      description: `BromeoRemote ${planName}`,
      webhookUrl: baseUrl() + '/api/webhooks/mollie',
      metadata: { userId, plan },
    });
    await upgradeUserLicense({ userId, plan, mollieSubscriptionId: subscription.id });
    return;
  }

  // Recurring payment succeeded (or a retried webhook for the first payment
  // that already created the subscription) — extends expires_at by another
  // month from this payment's timestamp and makes sure the license is
  // active, in case it had lapsed after a prior failed charge. Passing null
  // leaves the license's existing mollie_subscription_id as-is.
  await upgradeUserLicense({ userId, plan, mollieSubscriptionId: null });
}

/**
 * Self-service cancellation — a customer stopping their subscription, not an
 * admin action. Downgrades back to Free immediately rather than waiting for
 * the current billing period to run out (simpler and more honest than
 * partial-period logic we don't otherwise track).
 */
async function cancelUserSubscription(userId) {
  const { getUserMollieCustomerId, getMostRecentLicense, downgradeUserLicenseToFree } = require('./database');

  const license = await getMostRecentLicense(userId);
  const customerId = await getUserMollieCustomerId(userId);
  if (!license?.mollie_subscription_id || !customerId) {
    throw new Error('Geen actief abonnement gevonden om op te zeggen.');
  }

  if (mollieClient) {
    await mollieClient.customerSubscriptions.cancel(license.mollie_subscription_id, { customerId });
  }
  return downgradeUserLicenseToFree(userId);
}

const { verifyLicenseInDb } = require('./database');

async function verifyLicense({ licenseKey, email, hwid, platform, appVersion, ipAddress }) {
  const normHwid = normalizeDeviceId(hwid);
  const hwidHash = normHwid ? protectForStorage(normHwid) : null;
  return verifyLicenseInDb({ licenseKey, email, hwidHash, platform, appVersion, ipAddress });
}

module.exports = {
  normalizeDeviceId,
  protectForStorage,
  createSubscriptionCheckout,
  handleMollieWebhook,
  cancelUserSubscription,
  verifyLicense,
};
