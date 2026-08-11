// Dynamic pricing API endpoint
// GET: Fetch pricing settings and historical log
// POST: Calculate suggested prices for dates or apply price changes

import { requireSession } from '../_lib/auth.js';
import {
  getPark, getSitesForPark, getReservationsForPark, getPeakDateRanges,
  updatePricingSettings, updateSiteModifier, addPeakDateRange, removePeakDateRange,
  getPricingLog, logPricingChange, applyPricingChange,
} from '../_lib/reservations-store.js';
import { calculatePrice, calculatePricesForDateRange, analyzePricingImpact } from '../_lib/pricing-engine.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const park = await getPark(session.parkId);
  if (!park) return res.status(404).json({ error: 'Park not found' });

  // GET /api/admin/pricing — fetch all pricing data (settings, log, peaks)
  if (req.method === 'GET') {
    try {
      const sites = await getSitesForPark(session.parkId);
      const peakRanges = await getPeakDateRanges(session.parkId);
      const pricingLog = await getPricingLog(session.parkId);

      const settings = {
        dynamicPricingEnabled: park.dynamicPricingEnabled,
        minPriceCents: park.minPriceCents,
        maxPriceCents: park.maxPriceCents,
        occupancyTargetPercent: park.occupancyTargetPercent,
      };

      return res.status(200).json({
        settings,
        sites: sites.map((s) => ({
          id: s.id,
          name: s.name,
          baseRate: s.nightlyRateCents,
          priceModifier: s.priceModifier,
        })),
        peakRanges,
        pricingLog,
      });
    } catch (err) {
      console.error('Pricing GET error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  // POST /api/admin/pricing — handle various pricing actions
  if (req.method === 'POST') {
    const { action, ...payload } = req.body || {};

    try {
      // Action: update pricing settings
      if (action === 'updateSettings') {
        const updated = await updatePricingSettings(session.parkId, payload);
        return res.status(200).json({ park: updated });
      }

      // Action: calculate suggested prices for a specific date range
      if (action === 'calculate') {
        const { dateRange, includeRecommendations = true } = payload;
        if (!dateRange || !dateRange.start || !dateRange.end) {
          return res.status(400).json({ error: 'Date range required: { start, end }' });
        }

        const sites = await getSitesForPark(session.parkId);
        const reservations = await getReservationsForPark(session.parkId);
        const peakRanges = await getPeakDateRanges(session.parkId);

        // Calculate occupancy for each date in the range
        const occupancyByDate = {};
        for (const res of reservations) {
          if (res.status !== 'confirmed' && res.status !== 'confirmed-deposit') continue;
          let current = new Date(res.checkIn);
          const checkOut = new Date(res.checkOut);
          while (current < checkOut) {
            const dateStr = current.toISOString().split('T')[0];
            occupancyByDate[dateStr] = (occupancyByDate[dateStr] || 0) + 1;
            current.setDate(current.getDate() + 1);
          }
        }

        // Calculate max occupancy percentage per date
        const maxOccupancyByDate = {};
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        const daysInRange = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

        for (const [dateStr, bookedCount] of Object.entries(occupancyByDate)) {
          const occupancyPercent = (bookedCount / sites.length) * 100;
          maxOccupancyByDate[dateStr] = Math.min(100, occupancyPercent);
        }

        // Generate suggestions for all sites
        const suggestions = [];
        for (const site of sites) {
          const current = new Date(dateRange.start);
          while (current < new Date(dateRange.end)) {
            const dateStr = current.toISOString().split('T')[0];
            const occupancyPercent = maxOccupancyByDate[dateStr] || 50;

            const pricing = calculatePrice({
              baseRateCents: site.nightlyRateCents,
              checkInDate: dateStr,
              siteOccupancyPercent: occupancyPercent,
              siteModifier: site.priceModifier,
              peakDateRanges: peakRanges.map((p) => ({
                startDate: p.startDate,
                endDate: p.endDate,
              })),
            });

            // Apply min/max bounds from park settings
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

        // Calculate potential revenue impact
        let potentialImpact = null;
        if (includeRecommendations) {
          const relevantReservations = reservations.filter((r) => {
            const resStart = new Date(r.checkIn);
            const resEnd = new Date(r.checkOut);
            return resStart < new Date(dateRange.end) && resEnd > new Date(dateRange.start);
          });

          potentialImpact = analyzePricingImpact(relevantReservations, suggestions);
        }

        return res.status(200).json({
          suggestions,
          potentialImpact,
          occupancyByDate: maxOccupancyByDate,
        });
      }

      // Action: apply suggested price to a site/date
      if (action === 'applyPrice') {
        const { siteId, dateOfStay, appliedRateCents } = payload;
        if (!siteId || !dateOfStay || !appliedRateCents) {
          return res.status(400).json({ error: 'siteId, dateOfStay, and appliedRateCents required' });
        }

        // Check if there's already a pending log entry for this date/site
        const existingLogs = await getPricingLog(session.parkId, dateOfStay, dateOfStay);
        const existingLog = existingLogs.find(
          (l) => l.siteId === siteId && l.dateOfStay === dateOfStay && l.status !== 'applied'
        );

        if (existingLog) {
          // Update existing log
          const updated = await applyPricingChange(
            existingLog.id,
            appliedRateCents,
            session.username
          );
          return res.status(200).json({ pricingLog: updated });
        }

        // Otherwise, need to know the previous rate to log properly
        const { previousRate } = payload;
        if (!previousRate) {
          return res.status(400).json({ error: 'previousRate required for new price log' });
        }

        const logged = await logPricingChange(
          session.parkId,
          siteId,
          dateOfStay,
          previousRate,
          appliedRateCents
        );

        const updated = await applyPricingChange(
          logged.id,
          appliedRateCents,
          session.username
        );

        return res.status(201).json({ pricingLog: updated });
      }

      // Action: toggle dynamic pricing on/off
      if (action === 'toggleDynamicPricing') {
        const updated = await updatePricingSettings(session.parkId, {
          dynamicPricingEnabled: !park.dynamicPricingEnabled,
        });
        return res.status(200).json({ park: updated });
      }

      // Action: update site-level price modifier
      if (action === 'updateSiteModifier') {
        const { siteId, priceModifier } = payload;
        if (!siteId || priceModifier === undefined) {
          return res.status(400).json({ error: 'siteId and priceModifier required' });
        }
        const updated = await updateSiteModifier(siteId, session.parkId, priceModifier);
        return res.status(200).json({ site: updated });
      }

      // Action: manage peak date ranges
      if (action === 'addPeakRange') {
        const { label, startDate, endDate } = payload;
        const updated = await addPeakDateRange(session.parkId, { label, startDate, endDate });
        return res.status(201).json({ peakRanges: updated });
      }

      if (action === 'removePeakRange') {
        const { rangeId } = payload;
        if (!rangeId) return res.status(400).json({ error: 'rangeId required' });
        const updated = await removePeakDateRange(session.parkId, rangeId);
        return res.status(200).json({ peakRanges: updated });
      }

      // Unknown action
      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      console.error('Pricing POST error:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
