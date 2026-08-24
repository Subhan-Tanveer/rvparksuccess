// Vercel serverless function — POST /api/send-audit-request
// Backs the "Book your free audit" form on contact.html (see
// src/js/contact.js). Sends two emails through the shared Gmail sender
// (marie@rvparksales.com, see api/_lib/mailer.js): a notification to Marie
// with the submitted details, and a confirmation to the email address the
// visitor typed in. If either send fails, the whole request fails — the
// frontend falls back to a mailto: link so the request isn't lost, and
// that fallback should only kick in when the email genuinely didn't go
// out.
import { sendEmail } from './_lib/mailer.js';

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, park, location, occupancy, phone, email } = req.body || {};
  if (!name || !park || !email) {
    return res.status(400).json({ error: 'Name, park name, and email are required' });
  }

  try {
    await sendEmail({
      to: 'marie@rvparksales.com',
      subject: `Free Audit Request: ${park}`,
      html: `
        <h2>New free audit request</h2>
        <p>
          <strong>Name:</strong> ${escapeHtml(name)}<br>
          <strong>Park Name:</strong> ${escapeHtml(park)}<br>
          ${location ? `<strong>Location:</strong> ${escapeHtml(location)}<br>` : ''}
          ${occupancy ? `<strong>Current Occupancy:</strong> ${escapeHtml(occupancy)}%<br>` : ''}
          ${phone ? `<strong>Phone:</strong> ${escapeHtml(phone)}<br>` : ''}
          <strong>Email:</strong> ${escapeHtml(email)}
        </p>
      `,
    });

    await sendEmail({
      to: email,
      subject: "You're booked in for your free audit",
      html: `
        <h2>Thanks, ${escapeHtml(name)}!</h2>
        <p>We've got your free audit request for <strong>${escapeHtml(park)}</strong>${location ? ` in ${escapeHtml(location)}` : ''}.</p>
        <p>We'll look over your site, listings, and booking flow and send back a plain-English breakdown of what's costing you occupancy — usually within one business day.</p>
        <p>If anything comes up in the meantime, just reply to this email or reach us at (850) 555-0199.</p>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-audit-request failed:', err.message);
    return res.status(500).json({ error: 'Could not send audit request email' });
  }
}
