const nodemailer = require("nodemailer");
const { config } = require("./config");

let transporter = null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getTransporter() {
  if (!config.mailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }
  return transporter;
}

async function sendContactNotification(contact) {
  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    console.warn("SMTP is niet volledig ingesteld; contactmail niet verzonden.");
    return false;
  }

  const subject = `BromeoRemote contact: ${contact.subject}`;
  const html = `
    <h2>Nieuwe aanvraag via bromeoremote.com</h2>
    <p><strong>Naam:</strong> ${escapeHtml(contact.name)}</p>
    <p><strong>E-mail:</strong> ${escapeHtml(contact.email)}</p>
    <p><strong>Bedrijf:</strong> ${escapeHtml(contact.company || "-")}</p>
    <p><strong>Onderwerp:</strong> ${escapeHtml(contact.subject)}</p>
    <p><strong>Bericht:</strong></p>
    <p>${escapeHtml(contact.message).replace(/\n/g, "<br>")}</p>
  `;

  await activeTransporter.sendMail({
    from: config.smtp.from,
    to: config.smtp.to,
    replyTo: contact.email,
    subject,
    text: [
      "Nieuwe aanvraag via bromeoremote.com",
      "",
      `Naam: ${contact.name}`,
      `E-mail: ${contact.email}`,
      `Bedrijf: ${contact.company || "-"}`,
      `Onderwerp: ${contact.subject}`,
      "",
      contact.message,
    ].join("\n"),
    html,
  });

  return true;
}

module.exports = { sendContactNotification };
