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

/**
 * Creates a Mollie checkout session for a new Professional subscription.
 * @param {string} email - The user's email
 * @param {string} userId - The user's database UUID
 * @returns {Promise<string>} The checkout URL
 */
async function createSubscriptionCheckout(email, userId, plan = 'Pro') {
  if (!mollieClient) {
    throw new Error('Mollie is niet geconfigureerd op de server. MOLLIE_API_KEY ontbreekt.');
  }

  const prices = {
    Pro: '7.95',
    Unlimited: '50.00'
  };

  const amountValue = prices[plan] || '7.95';
  const planName = plan === 'Unlimited' ? 'Unlimited (€50,00/mnd)' : 'Pro (€7,95/mnd)';

  const customer = await mollieClient.customers.create({
    name: 'BromeoRemote Gebruiker',
    email: email,
    metadata: { userId }
  });

  const payment = await mollieClient.payments.create({
    amount: {
      value: amountValue,
      currency: 'EUR'
    },
    customerId: customer.id,
    sequenceType: 'first',
    description: `BromeoRemote ${planName}`,
    redirectUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000') + '/dashboard.html?payment=success',
    webhookUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000') + '/api/webhooks/mollie',
    metadata: {
      userId: userId,
      plan: plan
    }
  });

  return payment.getCheckoutUrl();
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
  verifyLicense,
};
