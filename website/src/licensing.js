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
async function createSubscriptionCheckout(email, userId) {
  if (!mollieClient) {
    throw new Error('Mollie is not configured. MOLLIE_API_KEY is missing.');
  }

  // 1. Create or get Mollie Customer (simplified for this demo)
  const customer = await mollieClient.customers.create({
    name: 'BromeoRemote User',
    email: email,
    metadata: { userId }
  });

  // 2. Create the first mandate payment (recurring-first)
  // According to Mollie, to start a subscription you first need a valid mandate.
  // We do a small first payment or direct checkout.
  const payment = await mollieClient.payments.create({
    amount: {
      value: '19.00',
      currency: 'EUR'
    },
    customerId: customer.id,
    sequenceType: 'first',
    description: 'BromeoRemote Professional (1e maand)',
    redirectUrl: (process.env.BASE_URL || 'http://localhost:3000') + '/dashboard?payment=success',
    webhookUrl: (process.env.BASE_URL || 'http://localhost:3000') + '/api/webhooks/mollie',
    metadata: {
      userId: userId,
      plan: 'Professional'
    }
  });

  return payment.getCheckoutUrl();
}

module.exports = {
  normalizeDeviceId,
  protectForStorage,
  createSubscriptionCheckout
};
