// Minimal Gmail SMTP sender. GMAIL_USER/GMAIL_APP_PASSWORD are already
// configured on the Vercel project (see README's Contact form setup
// section) but nothing in this codebase actually sent mail through them
// yet — src/js's contact form has no backend wiring, and the separate
// email-provider.js abstraction reads different env var names
// (EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD) that were never set, so it's
// silently a no-op. This is deliberately small and specific rather than
// routed through that abstraction.
import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) throw new Error('Email is not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing)');
  return t.sendMail({
    from: `RVPark Success <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
  });
}
