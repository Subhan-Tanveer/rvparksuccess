// Vercel serverless function — sends the "Book a Free Audit" form via Gmail SMTP.
//
// Requires two environment variables set in the Vercel project dashboard
// (Project → Settings → Environment Variables), never in this file or any
// other file in this repo:
//   GMAIL_USER          the sending Gmail address (e.g. marie@rvparksales.com)
//   GMAIL_APP_PASSWORD  a Gmail App Password for that account (Google Account
//                        → Security → 2-Step Verification → App passwords)
//
// Sends two emails per submission: an internal notification to NOTIFY_EMAIL,
// and a confirmation to the customer's own submitted address.
import nodemailer from 'nodemailer';

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

  const details = `
    <p><b>Name:</b> ${escapeHtml(name)}</p>
    <p><b>Park Name:</b> ${escapeHtml(park)}</p>
    <p><b>Location:</b> ${escapeHtml(location || '—')}</p>
    <p><b>Current Occupancy:</b> ${escapeHtml(occupancy || '—')}%</p>
    <p><b>Phone:</b> ${escapeHtml(phone || '—')}</p>
    <p><b>Email:</b> ${escapeHtml(email)}</p>
  `;

  try {
    await transporter.sendMail({
      from: `"RVPark Success" <${process.env.GMAIL_USER}>`,
      to: NOTIFY_EMAIL,
      replyTo: email,
      subject: `Free Audit Request: ${park}`,
      html: `<h2>New free audit request</h2>${details}`,
    });

    await transporter.sendMail({
      from: `"RVPark Success" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'We got your free audit request — RVPark Success',
      html: `
        <p>Hi ${escapeHtml(name)},</p>
        <p>Thanks for booking a free audit for <b>${escapeHtml(park)}</b> — we'll review your current site, listings, and booking flow and get back to you within one business day with a plain-English breakdown of what's leaving occupancy on the table.</p>
        <p>Here's what you submitted, for your records:</p>
        ${details}
        <p>Talk soon,<br>RVPark Success</p>
      `,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: 'Unable to send email right now.' });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
