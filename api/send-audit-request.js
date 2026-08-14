// Vercel serverless function — sends the "Book a Free Audit" form via Gmail SMTP.
//
// Requires two environment variables set in the Vercel project dashboard
// (Project → Settings → Environment Variables), never in this file or any
// other file in this repo:
//   GMAIL_USER          the sending Gmail address (e.g. marie@rvparksales.com)
//   GMAIL_APP_PASSWORD  a Gmail App Password for that account (Google Account
//                        → Security → 2-Step Verification → App passwords)
//
// Sends two branded emails per submission (see api/_lib/email-template.js):
// an internal notification to NOTIFY_EMAIL, and a confirmation to the
// customer's own submitted address.
import nodemailer from 'nodemailer';
import { renderEmail } from './_lib/email-template.js';

const NOTIFY_EMAIL = 'marie@rvparksales.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, park, location, occupancy, phone, email } = req.body || {};
  if (!name || !park || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('Gmail credentials not configured (GMAIL_USER / GMAIL_APP_PASSWORD env vars missing)');
    return res.status(500).json({ error: 'Email is not configured yet.' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  const details = [
    ['Name', name],
    ['Park Name', park],
    ['Location', location],
    ['Occupancy', occupancy ? `${occupancy}%` : ''],
    ['Phone', phone],
    ['Email', email],
  ];

  const internalHtml = renderEmail({
    eyebrow: 'New Lead',
    title: 'New free audit request',
    intro: `${name} just requested a free audit for ${park}. Reply directly to this email to reach them.`,
    details,
    cta: { label: `Reply to ${name}`, href: `mailto:${email}` },
  });

  const customerHtml = renderEmail({
    eyebrow: 'Free, No-Obligation',
    title: 'We got your free audit request',
    intro: `Hi ${name}, thanks for booking a free audit for ${park}. We'll review your current site, listings, and booking flow and get back to you within one business day with a plain-English breakdown of what's leaving occupancy on the table.`,
    details,
    closing: "If anything above isn't quite right, just reply to this email and let us know.",
  });

  try {
    await transporter.sendMail({
      from: `"RVPark Success" <${process.env.GMAIL_USER}>`,
      to: NOTIFY_EMAIL,
      replyTo: email,
      subject: `Free Audit Request: ${park}`,
      html: internalHtml,
    });

    await transporter.sendMail({
      from: `"RVPark Success" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'We got your free audit request — RVPark Success',
      html: customerHtml,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: 'Unable to send email right now.' });
  }
}
