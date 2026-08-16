// Shared price-suggestion + auto-apply logic for Dynamic Pricing — computes
// suggestions the exact same way the manual "Calculate Suggested Prices"
// button does (api/admin/features.js), so the nightly auto-apply cron
// (api/cron/dynamic-pricing.js) can never drift into different numbers for
// the same inputs.
import { calculatePrice } from './pricing-engine.js';
import {
  getPark,
  getSitesForPark,
  getReservationsForPark,
  getPeakDateRanges,
  applyDynamicPriceOverride,
  logPricingChange,
  applyPricingChange,
  listParksForAdmin,
} from './reservations-store.js';

export async function computePriceSuggestionsForPark(parkId, startDate, endDate) {
  const park = await getPark(parkId);
  const sites = await getSitesForPark(parkId);
  const reservations = await getReservationsForPark(parkId);
  const peakRanges = await getPeakDateRanges(parkId);

  const occupancyByDate = {};
  const reservationCountBySite = {};
  for (const r of reservations) {
    if (r.status !== 'confirmed' && r.status !== 'confirmed-deposit') continue;
    reservationCountBySite[r.siteId] = (reservationCountBySite[r.siteId] || 0) + 1;
    let current = new Date(r.checkIn);
    const checkOut = new Date(r.checkOut);
    while (current < checkOut) {
      const dateStr = current.toISOString().split('T')[0];
      occupancyByDate[dateStr] = (occupancyByDate[dateStr] || 0) + 1;
      current.setDate(current.getDate() + 1);
    }
  }
  const maxOccupancyByDate = {};
  for (const [dateStr, bookedCount] of Object.entries(occupancyByDate)) {
    maxOccupancyByDate[dateStr] = Math.min(100, (bookedCount / sites.length) * 100);
  }

  const suggestions = [];
  for (const site of sites) {
    const current = new Date(startDate);
    while (current < new Date(endDate)) {
      const dateStr = current.toISOString().split('T')[0];
      const occupancyPercent = maxOccupancyByDate[dateStr] || 50;

      const pricing = calculatePrice({
        baseRateCents: site.nightlyRateCents,
        checkInDate: dateStr,
        siteOccupancyPercent: occupancyPercent,
        siteModifier: site.priceModifier,
        peakDateRanges: peakRanges.map((p) => ({ startDate: p.startDate, endDate: p.endDate })),
        occupancyTargetPercent: park.occupancyTargetPercent,
      });

      let suggestedCents = pricing.suggestedCents;
      if (suggestedCents < park.minPriceCents) suggestedCents = park.minPriceCents;
      if (suggestedCents > park.maxPriceCents) suggestedCents = park.maxPriceCents;

      suggestions.push({
        siteId: site.id,
        siteName: site.name,
        date: dateStr,
        occupancyPercent: Math.round(occupancyPercent),
        currentRate: site.nightlyRateCents,
        suggestedRate: suggestedCents,
        multiplier: pricing.priceMultiplier,
        confidence: pricing.confidence,
        reasoning: pricing.reasoning,
      });

      current.setDate(current.getDate() + 1);
    }
  }

  return { park, suggestions, reservationCountBySite };
}

const AUTO_APPLY_HORIZON_DAYS = 30;
// Below this confidence, a price change is left as a logged suggestion for
// the owner to review in the Pricing Log instead of silently changing what
// a guest pays — matches the caution the manual flow already implies by
// showing a confidence badge on every suggestion.
const AUTO_APPLY_CONFIDENCE_THRESHOLD = 70;
// calculatePrice()'s confidence score leans heavily on how *soon* a date
// is, not on how much real booking history backs the prediction — so a
// brand-new site with zero reservations would still score high confidence
// for near-term dates. This second gate requires actual history before
// auto-applying anything, same "need 3+ bookings" bar the ML rate
// optimizer already uses elsewhere in this app before it trusts a model.
const AUTO_APPLY_MIN_SITE_BOOKINGS = 3;

export async function runAutoDynamicPricingForPark(parkId) {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + AUTO_APPLY_HORIZON_DAYS);
  const startDate = start.toISOString().split('T')[0];
  const endDate = end.toISOString().split('T')[0];

  const { suggestions, reservationCountBySite } = await computePriceSuggestionsForPark(parkId, startDate, endDate);

  let applied = 0;
  let skippedLowConfidence = 0;
  let skippedInsufficientHistory = 0;
  for (const s of suggestions) {
    if (s.suggestedRate === s.currentRate) continue; // no change — nothing to log or apply

    const logged = await logPricingChange(parkId, s.siteId, s.date, s.currentRate, s.suggestedRate);
    const hasEnoughHistory = (reservationCountBySite[s.siteId] || 0) >= AUTO_APPLY_MIN_SITE_BOOKINGS;

    if (!hasEnoughHistory) {
      skippedInsufficientHistory++;
    } else if (s.confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD) {
      await applyDynamicPriceOverride(s.siteId, parkId, s.date, s.suggestedRate);
      await applyPricingChange(logged.id, s.suggestedRate, 'dynamic-pricing-auto');
      applied++;
    } else {
      skippedLowConfidence++;
    }
  }

  return { parkId, totalConsidered: suggestions.length, applied, skippedLowConfidence, skippedInsufficientHistory };
}

export async function runAutoDynamicPricingForAllParks() {
  const parks = await listParksForAdmin();
  const results = [];
  for (const park of parks) {
    if (!park.dynamicPricingEnabled) continue;
    try {
      results.push(await runAutoDynamicPricingForPark(park.id));
    } catch (err) {
      results.push({ parkId: park.id, error: err.message });
    }
  }
  return results;
}
