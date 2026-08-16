// GET /api/cron/dynamic-pricing — runs nightly (see vercel.json's `crons`).
// For every park with Dynamic Pricing turned on, computes suggested rates
// for the next 30 days and auto-applies the ones the model is confident
// about; low-confidence ones are left as logged suggestions in the Pricing
// Log for the owner to review manually. This is what makes the "Dynamic
// Pricing ON" toggle in the dashboard actually do something — previously
// it was only a stored preference with no automated behavior behind it.
import { runAutoDynamicPricingForAllParks } from '../_lib/dynamic-pricing.js';

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
  // when a CRON_SECRET env var is set on the project — this rejects any
  // other caller. If CRON_SECRET isn't configured, refuse rather than
  // silently allowing unauthenticated triggers of a job that changes
  // guest-facing prices.
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET is not configured' });
  if (req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = await runAutoDynamicPricingForAllParks();
    const totals = results.reduce(
      (acc, r) => ({
        applied: acc.applied + (r.applied || 0),
        skippedLowConfidence: acc.skippedLowConfidence + (r.skippedLowConfidence || 0),
      }),
      { applied: 0, skippedLowConfidence: 0 }
    );
    return res.status(200).json({ ok: true, parksProcessed: results.length, totals, results });
  } catch (err) {
    console.error('Dynamic pricing cron error:', err.message);
    return res.status(500).json({ error: 'Dynamic pricing run failed' });
  }
}
