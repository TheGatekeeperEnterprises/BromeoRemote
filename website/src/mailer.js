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

function formatFrom(rawFrom) {
  if (!rawFrom) return '"BromeoRemote" <info@bromeoremote.com>';
  if (rawFrom.includes("<")) return rawFrom;
  return `"BromeoRemote" <${rawFrom}>`;
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
    <div style="background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 40px 16px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);">
        <div style="background-color: #0b1425; padding: 24px; text-align: center; border-bottom: 3px solid #10b981;">
          <img src="https://bromeoremote.com/assets/logo2.png" alt="BromeoRemote" style="height: 40px; width: auto; max-width: 220px; display: inline-block; vertical-align: middle;">
        </div>
        <div style="padding: 32px 28px;">
          <div style="display: inline-block; background-color: rgba(16, 185, 129, 0.12); color: #059669; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 4px 12px; border-radius: 99px; margin-bottom: 12px;">Nieuwe Contactaanvraag</div>
          <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 20px 0; line-height: 1.3;">Nieuw bericht ontvangen via het contactformulier</h1>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; width: 110px;">Afzender</td>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 15px; font-weight: 700; color: #0f172a;">${escapeHtml(contact.name)}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase;">E-mailadres</td>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 15px; color: #0ea5e9;"><a href="mailto:${escapeHtml(contact.email)}" style="color: #0ea5e9; text-decoration: none; font-weight: 600;">${escapeHtml(contact.email)}</a></td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase;">Bedrijf</td>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 15px; color: #334155;">${escapeHtml(contact.company || "-")}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase;">Onderwerp</td>
              <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 15px; font-weight: 700; color: #0f172a;">${escapeHtml(contact.subject)}</td>
            </tr>
          </table>

          <div style="font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Bericht inhoud:</div>
          <div style="background-color: #f8fafc; border-left: 4px solid #10b981; border-radius: 0 8px 8px 0; padding: 18px 20px; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${escapeHtml(contact.message)}</div>
          
          <div style="margin-top: 28px; text-align: center;">
            <a href="mailto:${escapeHtml(contact.email)}?subject=Re:%20${encodeURIComponent(contact.subject)}" style="display: inline-block; background-color: #10b981; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 10px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);">Beantwoord bericht</a>
          </div>
        </div>
        <div style="background-color: #f1f5f9; padding: 18px 28px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
          BromeoRemote &bull; Professional Remote Desktop Software &bull; <a href="https://bromeoremote.com" style="color: #64748b; text-decoration: underline;">bromeoremote.com</a>
        </div>
      </div>
    </div>
  `;

  await activeTransporter.sendMail({
    from: formatFrom(config.smtp.from),
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

async function sendContactConfirmation(contact) {
  const activeTransporter = getTransporter();
  if (!activeTransporter || !contact.email) return false;

  const subject = `Ontvangstbevestiging: Wij hebben je bericht ontvangen — BromeoRemote`;
  const html = `
    <div style="background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 40px 16px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);">
        <div style="background-color: #0b1425; padding: 24px; text-align: center; border-bottom: 3px solid #10b981;">
          <img src="https://bromeoremote.com/assets/logo2.png" alt="BromeoRemote" style="height: 40px; width: auto; max-width: 220px; display: inline-block; vertical-align: middle;">
        </div>
        <div style="padding: 32px 28px;">
          <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 12px 0; line-height: 1.3;">Bedankt voor je bericht, ${escapeHtml(contact.name)}!</h1>
          <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 20px 0;">
            Wij hebben je aanvraag via bromeoremote.com in goede orde ontvangen. Ons team bekijkt je bericht zo snel mogelijk en zal zo nodig per e-mail reageren.
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <div style="font-size: 12px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Samenvatting van je bericht</div>
            <p style="font-size: 14px; margin: 0 0 8px 0; color: #0f172a;"><strong>Onderwerp:</strong> ${escapeHtml(contact.subject)}</p>
            <div style="font-size: 13px; line-height: 1.5; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 10px; white-space: pre-wrap;">${escapeHtml(contact.message)}</div>
          </div>

          <p style="font-size: 14px; line-height: 1.5; color: #64748b; margin: 0;">
            Met vriendelijke groet,<br>
            <strong style="color: #0f172a;">Het BromeoRemote Team</strong><br>
            <a href="https://bromeoremote.com" style="color: #0ea5e9; text-decoration: none;">bromeoremote.com</a>
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 18px 28px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
          &copy; 2026 The Gatekeeper Enterprises &bull; BromeoRemote &bull; All rights reserved.
        </div>
      </div>
    </div>
  `;

  try {
    await activeTransporter.sendMail({
      from: formatFrom(config.smtp.from),
      to: contact.email,
      replyTo: config.smtp.to || config.smtp.from,
      subject,
      headers: {
        "Auto-Submitted": "auto-replied",
        "X-Auto-Response-Suppress": "All",
        "Precedence": "auto_reply",
        "X-Report-Abuse-To": config.smtp.from,
      },
      text: [
        `Bedankt voor je bericht, ${contact.name}!`,
        "",
        "Wij hebben je aanvraag via bromeoremote.com in goede orde ontvangen.",
        "",
        "SAMENVATTING VAN JE BERICHT:",
        `Onderwerp: ${contact.subject}`,
        `Bericht: ${contact.message}`,
        "",
        "Met vriendelijke groet,",
        "Het BromeoRemote Team",
        "https://bromeoremote.com",
        "The Gatekeeper Enterprises",
      ].join("\n"),
      html,
    });
    return true;
  } catch (err) {
    console.error("[Mailer] Fout bij verzenden van ontvangstbevestiging:", err.message);
    return false;
  }
}

async function sendPasswordResetEmail(email, resetUrl) {
  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    console.warn(`SMTP is niet volledig ingesteld; wachtwoord-resetmail niet verzonden naar ${email}. Reset-URL: ${resetUrl}`);
    return false;
  }

  const html = `
    <div style="background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 40px 16px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);">
        <div style="background-color: #0b1425; padding: 24px; text-align: center; border-bottom: 3px solid #10b981;">
          <img src="https://bromeoremote.com/assets/logo2.png" alt="BromeoRemote" style="height: 40px; width: auto; max-width: 220px; display: inline-block; vertical-align: middle;">
        </div>
        <div style="padding: 32px 28px;">
          <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 12px 0; line-height: 1.3;">Wachtwoord resetten</h1>
          <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 24px 0;">
            Er is een aanvraag gedaan om het wachtwoord voor je BromeoRemote account te resetten. Klik op de knop hieronder om een nieuw wachtwoord in te stellen. Deze link is <strong>1 uur</strong> geldig.
          </p>

          <div style="text-align: center; margin-bottom: 28px;">
            <a href="${escapeHtml(resetUrl)}" style="display: inline-block; background-color: #10b981; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 28px; border-radius: 10px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);">Nieuw wachtwoord instellen</a>
          </div>

          <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0;">
            Heb je dit niet aangevraagd? Dan kun je deze e-mail gerust negeren — je wachtwoord blijft dan gewoon ongewijzigd.
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 18px 28px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
          BromeoRemote &bull; Professional Remote Desktop Software &bull; <a href="https://bromeoremote.com" style="color: #64748b; text-decoration: underline;">bromeoremote.com</a>
        </div>
      </div>
    </div>
  `;

  await activeTransporter.sendMail({
    from: config.smtp.from,
    to: email,
    subject: "BromeoRemote — Wachtwoord resetten",
    text: [
      "Wachtwoord resetten voor je BromeoRemote account",
      "",
      "Klik op onderstaande link om een nieuw wachtwoord in te stellen. Deze link is 1 uur geldig.",
      resetUrl,
      "",
      "Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.",
    ].join("\n"),
    html,
  });

  return true;
}

async function sendLicenseWarningEmail(email, message) {
  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    console.warn(`SMTP is niet volledig ingesteld; waarschuwingsmail niet verzonden naar ${email}.`);
    return false;
  }

  const html = `
    <div style="background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 40px 16px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);">
        <div style="background-color: #0b1425; padding: 24px; text-align: center; border-bottom: 3px solid #10b981;">
          <img src="https://bromeoremote.com/assets/logo2.png" alt="BromeoRemote" style="height: 40px; width: auto; max-width: 220px; display: inline-block; vertical-align: middle;">
        </div>
        <div style="padding: 32px 28px;">
          <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 16px 0; line-height: 1.3;">Belangrijk bericht over je account</h1>
          <div style="font-size: 15px; line-height: 1.6; color: #334155;">${escapeHtml(message).replace(/\n/g, "<br>")}</div>
        </div>
        <div style="background-color: #f1f5f9; padding: 18px 28px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
          BromeoRemote &bull; Professional Remote Desktop Software &bull; <a href="https://bromeoremote.com" style="color: #64748b; text-decoration: underline;">bromeoremote.com</a>
        </div>
      </div>
    </div>
  `;

  await activeTransporter.sendMail({
    from: config.smtp.from,
    to: email,
    subject: "BromeoRemote — Belangrijk bericht over je account",
    text: message,
    html,
  });

  return true;
}

module.exports = {
  sendContactNotification,
  sendContactConfirmation,
  sendPasswordResetEmail,
  sendLicenseWarningEmail,
};
