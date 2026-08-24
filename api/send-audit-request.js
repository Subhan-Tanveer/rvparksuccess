// Vercel serverless function — POST /api/send-audit-request
// Backs the "Book your free audit" form on contact.html (see
// src/js/contact.js). Sends two emails through the shared Gmail sender
// (marie@rvparksales.com, see api/_lib/mailer.js), both built from the
// site's shared branded layout (api/_lib/email-template.js) so they look
// like they came from this site instead of a plain-text system email: a
// notification to Marie with the submitted details, and a confirmation to
// the email address the visitor typed in. If either send fails, the whole
// request fails — the frontend falls back to a mailto: link so the request
// isn't lost, and that fallback should only kick in when the email
// genuinely didn't go out.
import { sendEmail } from './_lib/mailer.js';
import { renderEmail } from './_lib/email-template.js';

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
      html: renderEmail({
        eyebrow: 'New Lead',
        title: `Free audit request: ${park}`,
        intro: `${name} just requested a free audit through the contact page.`,
        details: [
          ['Name', name],
          ['Park Name', park],
          ['Location', location],
          ['Current Occupancy', occupancy ? `${occupancy}%` : null],
          ['Phone', phone],
          ['Email', email],
        ],
      }),
    });

    await sendEmail({
      to: email,
      subject: "You're booked in for your free audit",
      html: renderEmail({
        eyebrow: 'Free, No-Obligation',
        title: `Thanks, ${name}!`,
        intro: `We've got your free audit request for ${park}${location ? ` in ${location}` : ''}. We'll look over your site, listings, and booking flow and send back a plain-English breakdown of what's costing you occupancy — usually within one business day.`,
        details: [
          ['Park Name', park],
          ['Location', location],
        ],
        cta: { label: 'Visit RVPark Success', href: 'https://www.rvparksuccess.com' },
        closing: 'If anything comes up in the meantime, just reply to this email or reach us at (850) 555-0199.',
      }),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-audit-request failed:', err.message);
    return res.status(500).json({ error: 'Could not send audit request email' });
  }
}
