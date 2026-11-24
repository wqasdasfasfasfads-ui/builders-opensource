// mailer.js - sends e-mail through SMTP (settings come from .env).

function mailConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS && !/^PASTE_/i.test(process.env.SMTP_PASS));
}

function sendMail({ subject, text, replyTo }) {
  if (!mailConfigured()) {
    return Promise.reject(new Error("SMTP_USER / SMTP_PASS are not set in .env"));
  }
  const nodemailer = require("nodemailer"); // run "npm install" if this says it is missing
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp-mail.outlook.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // port 587 = STARTTLS
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  return transport.sendMail({
    from: `"Builders" <${process.env.SMTP_USER}>`,
    to: process.env.REPORT_TO || "you@example.com",
    replyTo,
    subject,
    text,
  });
}

module.exports = { sendMail, mailConfigured };
