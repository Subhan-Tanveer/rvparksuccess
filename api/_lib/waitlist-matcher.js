// Smart Waitlist Matching — when a reservation is canceled, a site that
// was full is now open. Rather than staff working the waitlist by hand,
// this checks every not-yet-notified waitlist entry for that park against
// current real availability and emails whoever now has an open site,
// with an AI-drafted personalized note.
//
// The MATCH itself is plain, deterministic availability logic (does
// getAvailableSites return anything for this entry's exact dates?) —
// that's a real yes/no a park owner needs to trust, not something an LLM
// should be guessing at. The AI is used only to draft the notification
// copy, same "narrate, don't decide" boundary as every other AI feature
// in this app (api/_lib/ai-insights.js).
import { getPark, getUnnotifiedWaitlistForPark, getAvailableSites, markWaitlistNotified } from './reservations-store.js';
import { generateNarrative } from './ai-insights.js';
import { sendEmail } from './mailer.js';

const NOTIFY_SYSTEM_PROMPT = `You write short, warm booking-availability emails for an RV park. Given a guest's name, the park's name, and their requested dates, write a 3-4 sentence email body (no subject line, no greeting salutation like "Dear" — start with "Hi {name},") telling them a site just opened up for their requested dates at this park, and inviting them to call or reply to book it before it's gone. Plain text, no markdown, no placeholders left unfilled.`;

// Called after any reservation successfully moves to 'canceled'. Best-
// effort: a notification failure here should never undo or block the
// cancellation that triggered it, so every call site wraps this in a
// try/catch and only logs on error.
export async function notifyWaitlistOfOpening(parkId) {
  const park = await getPark(parkId);
  if (!park) return { notified: 0 };

  const candidates = await getUnnotifiedWaitlistForPark(parkId);
  if (!candidates.length) return { notified: 0 };

  let notified = 0;
  for (const entry of candidates) {
    if (!entry.checkIn || !entry.checkOut) continue; // open-ended requests have nothing concrete to match against
    const available = await getAvailableSites(parkId, entry.checkIn, entry.checkOut);
    if (!available.length) continue;

    let body;
    try {
      body = await generateNarrative(
        NOTIFY_SYSTEM_PROMPT,
        `Guest name: ${entry.name}\nPark name: ${park.name}\nRequested check-in: ${entry.checkIn}\nRequested check-out: ${entry.checkOut}`
      );
    } catch (err) {
      // AI drafting failed (e.g. NVIDIA_API_KEY missing/out of credit) —
      // fall back to a plain templated email rather than skipping the
      // notification entirely. The guest still needs to hear a site
      // opened up even if the copy isn't AI-polished.
      body = `Hi ${entry.name},\n\nA site just opened up at ${park.name} for your requested dates (${entry.checkIn} to ${entry.checkOut}). Reply to this email or call us to book it before it's gone.`;
    }

    try {
      await sendEmail({
        to: entry.email,
        subject: `A site just opened up at ${park.name}`,
        text: body,
        html: body.split('\n').filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join(''),
      });
      await markWaitlistNotified(entry.id);
      notified++;
    } catch (err) {
      console.error(`Waitlist notify failed for ${entry.email}:`, err.message);
    }
  }

  return { notified, checked: candidates.length };
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
