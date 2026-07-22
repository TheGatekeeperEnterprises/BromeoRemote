const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOWNLOAD_PLATFORMS = new Set(["windows", "windows-portable", "android", "github"]);

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/\r\n/g, "\n")
    .slice(0, maxLength);
}

function validateEmail(email) {
  const normalized = cleanText(email, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) return null;
  return normalized;
}

function validateContact(body) {
  const contact = {
    name: cleanText(body.name, 120),
    email: validateEmail(body.email),
    company: cleanText(body.company, 160),
    subject: cleanText(body.subject, 160),
    message: cleanText(body.message, 4000),
  };

  const errors = {};
  if (contact.name.length < 2) errors.name = "Vul je naam in.";
  if (!contact.email) errors.email = "Vul een geldig e-mailadres in.";
  if (contact.subject.length < 3) errors.subject = "Kies een onderwerp.";
  if (contact.message.length < 10) errors.message = "Schrijf kort waar je hulp bij nodig hebt.";

  return { value: contact, errors };
}

function validateNewsletter(body) {
  const email = validateEmail(body.email);
  const errors = {};
  if (!email) errors.email = "Vul een geldig e-mailadres in.";
  return { value: { email }, errors };
}

function validatePlatform(platform) {
  const normalized = cleanText(platform, 40).toLowerCase();
  return DOWNLOAD_PLATFORMS.has(normalized) ? normalized : null;
}

function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

module.exports = {
  hasErrors,
  validateContact,
  validateNewsletter,
  validatePlatform,
};
