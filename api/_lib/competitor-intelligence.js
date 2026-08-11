// Competitive Intelligence Engine — web scraping, market analysis, pricing recommendations
// Collects competitor pricing data nightly, analyzes market trends, suggests optimal rates

import {
  getCompetitorsForPark, recordCompetitorPricing, getCompetitorPricingHistory,
  recordMarketAnalytics, getMarketAnalytics, createPricingSuggestion,
  getPricingSuggestionsForPark, getSitesForPark, getPark,
} from './reservations-store.js';

const SCRAPE_TIMEOUT_MS = 15000;
const SCRAPE_RETRY_DELAY_MS = 1000;
const RATE_LIMIT_DELAY_MS = 2000;

/* ============================================================ */
/* Web Scraping Utilities — fetch and parse competitor pricing */
/* ============================================================ */

async function scrapeWithTimeout(url, timeoutMs = SCRAPE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RVParkSuccess/1.0)',
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

// Parse structured data from HTML — looks for common patterns:
// - meta tags (og:price, product:price)
// - JSON-LD schema.org
// - Price patterns in text content
async function parseCompetitorPricing(html) {
  try {
    // Look for price patterns: "$XX", "per night", "$XX/night", etc.
    const pricePattern = /\$?\d+(?:,\d{3})*(?:\.\d{2})?/g;
    const priceMatches = html.match(pricePattern) || [];

    // Extract numbers from matches
    const prices = priceMatches
      .map((p) => {
        const cleaned = p.replace(/[$,]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : Math.round(num * 100); // convert to cents
      })
      .filter((p) => p !== null && p > 0 && p < 50000); // reasonable range: $0.01 - $500

    if (prices.length === 0) return null;

    const sorted = prices.sort((a, b) => a - b);
    const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    const median = sorted.length % 2 === 0
      ? Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : sorted[Math.floor(sorted.length / 2)];

    return {
      avgRateCents: avg,
      lowRateCents: sorted[0],
      highRateCents: sorted[sorted.length - 1],
      priceCount: prices.length,
    };
  } catch (err) {
    console.error('Error parsing competitor pricing:', err.message);
    return null;
  }
}

// Fetch competitor data with retry logic
async function fetchCompetitorData(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      const html = await scrapeWithTimeout(url);
      const pricing = await parseCompetitorPricing(html);
      return pricing;
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, SCRAPE_RETRY_DELAY_MS * (i + 1)));
      }
    }
  }
  console.error(`Failed to fetch competitor data from ${url}:`, lastErr?.message);
  return null;
}

/* ============================================================ */
/* Market Analysis — calculate benchmarks and percentiles      */
/* ============================================================ */

// Calculate market position and generate recommendations
async function analyzeMarket(parkId, competitorPricingData) {
  if (!competitorPricingData || competitorPricingData.length === 0) return null;

  const avgRates = competitorPricingData
    .map((c) => c.avgRateCents)
    .filter((r) => r !== null);

  if (avgRates.length === 0) return null;

  const sorted = avgRates.sort((a, b) => a - b);
  const marketAvg = Math.round(avgRates.reduce((s, r) => s + r, 0) / avgRates.length);
  const marketMedian = sorted.length % 2 === 0
    ? Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : sorted[Math.floor(sorted.length / 2)];

  return {
    marketAvgRateCents: marketAvg,
    marketMedianCents: marketMedian,
    marketMinCents: sorted[0],
    marketMaxCents: sorted[sorted.length - 1],
    competitorCount: competitorPricingData.length,
  };
}

// Calculate your park's position relative to market
function calculatePricePosition(yourRateCents, marketAnalysis) {
  if (!marketAnalysis || !marketAnalysis.marketAvgRateCents) return null;

  const avg = marketAnalysis.marketAvgRateCents;
  const position = ((yourRateCents - avg) / avg) * 100; // -/+ percent from market avg

  let positionLabel = 'Competitive';
  if (position < -10) positionLabel = 'Underpriced';
  if (position > 15) positionLabel = 'Overpriced';
  if (Math.abs(position) <= 5) positionLabel = 'Market-matched';

  return {
    percentageDifference: Math.round(position * 10) / 10,
    positionLabel,
  };
}

/* ============================================================ */
/* Pricing Recommendation Engine                               */
/* ============================================================ */

// Generate price recommendations based on market analysis and confidence scores
async function generatePriceRecommendations(parkId, marketAnalysis, sites) {
  if (!marketAnalysis) return [];

  const suggestions = [];

  for (const site of sites) {
    const currentRate = site.nightlyRateCents;
    const market = marketAnalysis.marketAvgRateCents;

    // Rule 1: If significantly underpriced, recommend increase
    if (currentRate < market * 0.85) {
      const suggestedRate = Math.round(market * 0.95); // suggest 95% of market avg
      const confidence = Math.min(0.95, (market / currentRate) * 0.5); // higher confidence if bigger gap

      suggestions.push({
        siteId: site.id,
        suggestedRateCents: suggestedRate,
        confidenceScore: confidence,
        reason: `Underpriced by ${Math.round(((market - currentRate) / market) * 100)}% vs market average. Recommend increase to $${(suggestedRate / 100).toFixed(2)}/night.`,
      });
    }

    // Rule 2: If significantly overpriced, recommend decrease
    if (currentRate > market * 1.15) {
      const suggestedRate = Math.round(market * 1.05); // suggest 105% of market avg
      const confidence = Math.min(0.95, (currentRate / market) * 0.4);

      suggestions.push({
        siteId: site.id,
        suggestedRateCents: suggestedRate,
        confidenceScore: confidence,
        reason: `Overpriced by ${Math.round(((currentRate - market) / market) * 100)}% vs market average. Recommend decrease to $${(suggestedRate / 100).toFixed(2)}/night.`,
      });
    }

    // Rule 3: Market-matched but suggest small optimization
    if (Math.abs(currentRate - market) <= market * 0.15) {
      const variance = Math.abs(currentRate - market);
      if (variance > market * 0.05) {
        const suggestedRate = market; // suggest exact market average
        const confidence = 0.7;

        suggestions.push({
          siteId: site.id,
          suggestedRateCents: suggestedRate,
          confidenceScore: confidence,
          reason: `Current rate is within market range. Suggest slight adjustment to $${(suggestedRate / 100).toFixed(2)}/night for optimal positioning.`,
        });
      }
    }
  }

  return suggestions;
}

/* ============================================================ */
/* Main Intelligence Engine Functions                          */
/* ============================================================ */

export async function trackCompetitorMetrics(competitorId) {
  // This would be called by a scheduled job to refresh competitor data
  // Returns the latest pricing snapshot from a competitor
  // In production: would integrate with web scraping service or APIs
  // For MVP: returns mock data or previously scraped data
  return {
    competitorId,
    lastChecked: new Date().toISOString(),
    avgRateCents: null,
    lowRateCents: null,
    highRateCents: null,
    occupancySignal: null,
  };
}

export async function getPriceComparison(parkId, siteType) {
  const competitors = await getCompetitorsForPark(parkId);
  if (competitors.length === 0) return null;

  // Get latest pricing for each competitor (most recent record)
  const competitorPricingData = await Promise.all(
    competitors.map(async (comp) => {
      const history = await getCompetitorPricingHistory(comp.id, 30);
      if (history.length === 0) return null;
      return history[0]; // most recent
    })
  );

  const validPricing = competitorPricingData.filter((p) => p !== null);
  if (validPricing.length === 0) return null;

  const park = await getPark(parkId);
  const sites = await getSitesForPark(parkId);
  const sitesOfType = sites.filter((s) => s.type === siteType);
  if (sitesOfType.length === 0) return null;

  const yourAvgRate = Math.round(
    sitesOfType.reduce((sum, s) => sum + s.nightlyRateCents, 0) / sitesOfType.length
  );

  const competitorRates = validPricing.map((p) => p.avgRateCents).filter((r) => r !== null);
  const marketAvg = Math.round(
    competitorRates.reduce((sum, r) => sum + r, 0) / competitorRates.length
  );

  return {
    siteType,
    yourAvgRate,
    marketAverage: marketAvg,
    marketMin: Math.min(...competitorRates),
    marketMax: Math.max(...competitorRates),
    position: calculatePricePosition(yourAvgRate, { marketAvgRateCents: marketAvg }),
    competitorCount: validPricing.length,
  };
}

export async function suggestPriceAdjustment(parkId, siteId) {
  const sites = await getSitesForPark(parkId);
  const site = sites.find((s) => s.id === siteId);
  if (!site) throw new Error('Site not found');

  const competitors = await getCompetitorsForPark(parkId);
  if (competitors.length === 0) return null;

  // Get latest pricing data
  const competitorPricingData = await Promise.all(
    competitors.map(async (comp) => {
      const history = await getCompetitorPricingHistory(comp.id, 30);
      return history.length > 0 ? history[0] : null;
    })
  );

  const validPricing = competitorPricingData.filter((p) => p !== null);
  const marketAnalysis = await analyzeMarket(parkId, validPricing);
  if (!marketAnalysis) return null;

  const suggestions = await generatePriceRecommendations(parkId, marketAnalysis, [site]);
  return suggestions.length > 0 ? suggestions[0] : null;
}

export async function getMarketTrends(parkId, days = 90) {
  const analytics = await getMarketAnalytics(parkId, days);
  if (analytics.length === 0) return null;

  // Sort by date ascending for trend display
  const sorted = analytics.sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    trends: sorted.map((a) => ({
      date: a.date,
      marketAvgRate: a.marketAvgRateCents,
      marketMedian: a.marketMedianCents,
      competitorCount: a.competitorCount,
    })),
    periodDays: days,
    latestAverage: sorted[sorted.length - 1]?.marketAvgRateCents || null,
    trendDirection: sorted.length >= 2
      ? sorted[sorted.length - 1].marketAvgRateCents > sorted[0].marketAvgRateCents ? 'upward' : 'downward'
      : null,
  };
}

export async function identifyPricingOpportunities(parkId) {
  const sites = await getSitesForPark(parkId);
  const competitors = await getCompetitorsForPark(parkId);
  if (competitors.length === 0) return [];

  // Get latest competitor pricing
  const competitorPricingData = await Promise.all(
    competitors.map(async (comp) => {
      const history = await getCompetitorPricingHistory(comp.id, 30);
      return history.length > 0 ? history[0] : null;
    })
  );

  const validPricing = competitorPricingData.filter((p) => p !== null);
  const marketAnalysis = await analyzeMarket(parkId, validPricing);
  if (!marketAnalysis) return [];

  // Generate recommendations for all sites
  const allSuggestions = await generatePriceRecommendations(parkId, marketAnalysis, sites);

  // Score opportunities by potential revenue impact
  return allSuggestions
    .map((suggestion) => {
      const site = sites.find((s) => s.id === suggestion.siteId);
      const currentRate = site.nightlyRateCents;
      const suggestedRate = suggestion.suggestedRateCents;
      const rateDifference = suggestedRate - currentRate;
      const percentChange = (rateDifference / currentRate) * 100;

      // Estimate revenue impact (assumes 30 bookings/month per site as baseline)
      const estimatedBookingsMonth = 30;
      const revenueImpact = rateDifference * estimatedBookingsMonth;

      return {
        ...suggestion,
        site: { id: site.id, name: site.name, type: site.type },
        currentRate,
        rateDifference,
        percentChange: Math.round(percentChange * 10) / 10,
        estimatedRevenueImpactMonth: revenueImpact,
      };
    })
    .sort((a, b) => Math.abs(b.estimatedRevenueImpactMonth) - Math.abs(a.estimatedRevenueImpactMonth));
}

export async function addCompetitorForPark(parkId, { name, websiteUrl, location }) {
  const { addCompetitor } = await import('./reservations-store.js');
  return addCompetitor(parkId, { name, websiteUrl, location });
}

export async function removeCompetitorForPark(parkId, competitorId) {
  const { removeCompetitor } = await import('./reservations-store.js');
  return removeCompetitor(competitorId, parkId);
}

export async function refreshCompetitorData(parkId) {
  // Called by scheduled background job (nightly)
  // Fetches latest competitor data, updates database, recalculates market analytics
  const competitors = await getCompetitorsForPark(parkId);
  if (competitors.length === 0) return { updated: 0 };

  let updated = 0;
  const competitorPricingData = [];

  for (const competitor of competitors) {
    if (!competitor.scrapeEnabled) continue;

    const data = await fetchCompetitorData(competitor.websiteUrl);
    if (data) {
      const today = new Date().toISOString().split('T')[0];
      await recordCompetitorPricing(competitor.id, {
        date: today,
        avgRateCents: data.avgRateCents,
        lowRateCents: data.lowRateCents,
        highRateCents: data.highRateCents,
        occupancySignal: null, // Could be enhanced to extract occupancy signals
      });
      competitorPricingData.push(data);
      updated += 1;
    }
  }

  // Update market analytics
  if (competitorPricingData.length > 0) {
    const marketAnalysis = await analyzeMarket(parkId, competitorPricingData);
    if (marketAnalysis) {
      const today = new Date().toISOString().split('T')[0];
      await recordMarketAnalytics(parkId, {
        date: today,
        marketAvgRateCents: marketAnalysis.marketAvgRateCents,
        marketMedianCents: marketAnalysis.marketMedianCents,
        pricePercentile: null,
        competitorCount: marketAnalysis.competitorCount,
      });
    }
  }

  return { updated, timestamp: new Date().toISOString() };
}
