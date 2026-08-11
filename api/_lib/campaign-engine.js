/**
 * Campaign Engine — Promotional campaigns orchestration
 *
 * Handles:
 * - Campaign execution (email + SMS sends)
 * - Performance tracking (opens, clicks, conversions)
 * - ROI calculation
 * - A/B testing
 */

import { sendEmail } from './email-provider.js';
import TwilioSMSService from './sms-service.js';
import {
  createCampaign, getCampaign, getCampaignsByPark, updateCampaign, deleteCampaign,
  addCampaignRecipient, getCampaignRecipients, updateCampaignRecipient,
  getCampaignPerformance, updateCampaignPerformance,
  createCampaignVariant, getCampaignVariants, updateCampaignVariant,
} from './reservations-store.js';

const CAMPAIGN_TYPES = {
  SEASONAL: 'seasonal',
  LOYALTY: 'loyalty',
  EVENT_DRIVEN: 'event-driven',
  BEHAVIORAL: 'behavioral',
  REFERRAL: 'referral',
};

const CAMPAIGN_STATUSES = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  PAUSED: 'paused',
};

/**
 * Initialize SMS service if Twilio credentials available
 */
function initSmsService() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('SMS service not configured: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required');
    return null;
  }

  try {
    return new TwilioSMSService(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (err) {
    console.error('Failed to initialize SMS service:', err.message);
    return null;
  }
}

const smsService = initSmsService();

/**
 * Create a new campaign with validation
 */
export async function engineCreateCampaign(parkId, campaignConfig) {
  const {
    name, type, startDate, endDate, budgetCents, discountAmount, discountType, promoCode, description,
  } = campaignConfig;

  // Validate campaign type
  if (!Object.values(CAMPAIGN_TYPES).includes(type)) {
    throw new Error(`Invalid campaign type: ${type}`);
  }

  // Validate discount
  if (discountType === 'percent' && (discountAmount < 0 || discountAmount > 100)) {
    throw new Error('Percent discount must be between 0 and 100');
  }

  if (discountType === 'fixed' && discountAmount < 0) {
    throw new Error('Fixed discount cannot be negative');
  }

  return createCampaign(parkId, campaignConfig);
}

/**
 * Add recipients to a campaign (from guest list or segment)
 * Supports targeting by: all guests, loyal guests, inactive guests, at-risk guests
 */
export async function engineAddRecipients(campaignId, recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('Recipients must be a non-empty array');
  }

  const results = [];
  for (const recipient of recipients) {
    try {
      const added = await addCampaignRecipient(
        campaignId,
        recipient.email,
        recipient.phone || null,
        recipient.guestId || null
      );
      results.push(added);
    } catch (err) {
      console.error(`Failed to add recipient ${recipient.email}:`, err.message);
    }
  }

  if (results.length === 0) {
    throw new Error('Failed to add any recipients');
  }

  return results;
}

/**
 * Execute campaign — send emails/SMS to all recipients
 * Returns summary of sends (successful, failed)
 */
export async function engineExecuteCampaign(campaignId, options = {}) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const { sendEmail: shouldSendEmail = true, sendSms: shouldSendSms = true } = options;

  const recipients = await getCampaignRecipients(campaignId, 1000, 0);
  if (recipients.length === 0) {
    throw new Error('Campaign has no recipients');
  }

  // Get campaign variants for A/B testing
  const variants = await getCampaignVariants(campaignId);
  const variantA = variants.find(v => v.variantType === 'A');
  const variantB = variants.find(v => v.variantType === 'B');

  const summary = {
    totalRecipients: recipients.length,
    emailsSent: 0,
    emailsFailed: 0,
    smsSent: 0,
    smsFailed: 0,
    errors: [],
  };

  // Split recipients for A/B testing if both variants exist
  const recipientsA = variantB ? recipients.slice(0, Math.floor(recipients.length / 2)) : recipients;
  const recipientsB = variantB ? recipients.slice(Math.floor(recipients.length / 2)) : [];

  // Send emails for Variant A
  if (shouldSendEmail && variantA) {
    const emailResults = await sendCampaignEmails(recipientsA, variantA, campaign, 'A');
    summary.emailsSent += emailResults.successful;
    summary.emailsFailed += emailResults.failed;
    summary.errors.push(...emailResults.errors);
  }

  // Send emails for Variant B
  if (shouldSendEmail && variantB) {
    const emailResults = await sendCampaignEmails(recipientsB, variantB, campaign, 'B');
    summary.emailsSent += emailResults.successful;
    summary.emailsFailed += emailResults.failed;
    summary.errors.push(...emailResults.errors);
  }

  // Send SMS (only if single variant or variant A)
  if (shouldSendSms && variantA && smsService) {
    const smsResults = await sendCampaignSms(recipientsA, variantA, campaign);
    summary.smsSent += smsResults.successful;
    summary.smsFailed += smsResults.failed;
    summary.errors.push(...smsResults.errors);
  }

  // Update campaign status to active
  await updateCampaign(campaignId, { status: CAMPAIGN_STATUSES.ACTIVE });

  return summary;
}

/**
 * Send campaign emails to a list of recipients
 */
async function sendCampaignEmails(recipients, variant, campaign, variantType) {
  const results = { successful: 0, failed: 0, errors: [] };

  for (const recipient of recipients) {
    try {
      if (!recipient.guestEmail) {
        results.failed++;
        continue;
      }

      const html = replaceTemplateVariables(variant.body || '', {
        name: recipient.guestEmail.split('@')[0],
        discount: campaign.discountAmount,
        discountType: campaign.discountType,
        promoCode: campaign.promoCode,
      });

      await sendEmail({
        to: recipient.guestEmail,
        subject: variant.subject || campaign.name,
        html,
        fromName: `${campaign.name} at RVPark Success`,
      });

      // Mark email as sent
      await updateCampaignRecipient(recipient.id, {
        emailSent: true,
        emailSentAt: new Date().toISOString(),
      });

      results.successful++;
    } catch (err) {
      results.failed++;
      results.errors.push(`Email to ${recipient.guestEmail}: ${err.message}`);
      console.error(`Failed to send campaign email to ${recipient.guestEmail}:`, err.message);
    }
  }

  return results;
}

/**
 * Send campaign SMS to a list of recipients
 */
async function sendCampaignSms(recipients, variant, campaign) {
  const results = { successful: 0, failed: 0, errors: [] };

  if (!smsService) {
    results.errors.push('SMS service not configured');
    return results;
  }

  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!fromNumber) {
    results.errors.push('TWILIO_FROM_NUMBER not configured');
    return results;
  }

  for (const recipient of recipients) {
    try {
      if (!recipient.guestPhone) {
        results.failed++;
        continue;
      }

      const message = replaceTemplateVariables(variant.smsBody || campaign.name, {
        discount: campaign.discountAmount,
        discountType: campaign.discountType,
        promoCode: campaign.promoCode,
      });

      // Limit SMS to 160 chars
      if (message.length > 160) {
        throw new Error('SMS message exceeds 160 characters');
      }

      const sendResult = await smsService.sendSMS(
        recipient.guestPhone,
        fromNumber,
        message
      );

      if (sendResult.status === 'failed') {
        results.failed++;
        results.errors.push(`SMS to ${recipient.guestPhone}: ${sendResult.error}`);
      } else {
        await updateCampaignRecipient(recipient.id, {
          smsSent: true,
          smsSentAt: new Date().toISOString(),
        });
        results.successful++;
      }
    } catch (err) {
      results.failed++;
      results.errors.push(`SMS to ${recipient.guestPhone}: ${err.message}`);
      console.error(`Failed to send campaign SMS to ${recipient.guestPhone}:`, err.message);
    }
  }

  return results;
}

/**
 * Track campaign performance — calculate opens, clicks, conversions, ROI
 */
export async function trackCampaignPerformance(campaignId) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const recipients = await getCampaignRecipients(campaignId, 10000, 0);

  // Calculate metrics
  const emailsSent = recipients.filter(r => r.emailSent).length;
  const emailsOpened = recipients.filter(r => r.emailOpened).length;
  const emailsClicked = recipients.filter(r => r.emailClicked).length;
  const conversions = recipients.filter(r => r.converted).length;

  const openRatePercent = emailsSent > 0 ? (emailsOpened / emailsSent) * 100 : 0;
  const clickRatePercent = emailsSent > 0 ? (emailsClicked / emailsSent) * 100 : 0;
  const conversionRatePercent = emailsSent > 0 ? (conversions / emailsSent) * 100 : 0;

  const revenueGeneratedCents = recipients
    .filter(r => r.converted)
    .reduce((sum, r) => sum + (r.conversionValueCents || 0), 0);

  // Estimate cost: SMS + email sending costs
  const costCents = (emailsSent * 50) + (recipients.filter(r => r.smsSent).length * 150); // Rough estimate

  const roiPercent = costCents > 0 ? ((revenueGeneratedCents - costCents) / costCents) * 100 : 0;

  const performance = {
    emailsSent,
    emailsOpened,
    emailsClicked,
    openRatePercent: Number(openRatePercent.toFixed(2)),
    clickRatePercent: Number(clickRatePercent.toFixed(2)),
    conversions,
    conversionRatePercent: Number(conversionRatePercent.toFixed(2)),
    revenueGeneratedCents,
    costCents,
    roiPercent: Number(roiPercent.toFixed(2)),
  };

  return updateCampaignPerformance(campaignId, performance);
}

/**
 * Calculate ROI for a campaign
 */
export async function calculateCampaignRoi(campaignId) {
  const performance = await getCampaignPerformance(campaignId);
  if (!performance) return null;

  return {
    revenueGeneratedCents: performance.revenueGeneratedCents,
    costCents: performance.costCents,
    roiPercent: performance.roiPercent,
    profitCents: performance.revenueGeneratedCents - performance.costCents,
  };
}

/**
 * Setup A/B test variants
 */
export async function setupAbTest(campaignId, variantA, variantB) {
  if (!variantA || !variantB) {
    throw new Error('Both variant A and B are required');
  }

  const aRes = await createCampaignVariant(campaignId, {
    ...variantA,
    variantType: 'A',
    variantName: variantA.name || 'Variant A',
  });

  const bRes = await createCampaignVariant(campaignId, {
    ...variantB,
    variantType: 'B',
    variantName: variantB.name || 'Variant B',
  });

  return { variantA: aRes, variantB: bRes };
}

/**
 * Determine A/B test winner based on performance
 */
export async function declareAbTestWinner(campaignId) {
  const variants = await getCampaignVariants(campaignId);
  if (variants.length < 2) {
    throw new Error('Campaign does not have A/B test variants');
  }

  const variantA = variants.find(v => v.variantType === 'A');
  const variantB = variants.find(v => v.variantType === 'B');

  // Compare conversion rates
  const aConversionRate = variantA.conversions > 0
    ? (variantA.conversions / variantA.emailsSent) * 100
    : 0;
  const bConversionRate = variantB.conversions > 0
    ? (variantB.conversions / variantB.emailsSent) * 100
    : 0;

  const winner = aConversionRate > bConversionRate ? variantA : variantB;
  const loser = aConversionRate > bConversionRate ? variantB : variantA;

  await updateCampaignVariant(winner.id, { isWinner: true });
  await updateCampaignVariant(loser.id, { isWinner: false });

  return {
    winner: winner.variantType,
    winnerConversionRate: aConversionRate > bConversionRate ? aConversionRate : bConversionRate,
    variants: {
      A: { conversions: variantA.conversions, rate: aConversionRate.toFixed(2) },
      B: { conversions: variantB.conversions, rate: bConversionRate.toFixed(2) },
    },
  };
}

/**
 * Mark email as opened (called by email pixel tracking)
 */
export async function trackEmailOpen(recipientId) {
  return updateCampaignRecipient(recipientId, {
    emailOpened: true,
  });
}

/**
 * Mark email link as clicked
 */
export async function trackEmailClick(recipientId) {
  return updateCampaignRecipient(recipientId, {
    emailClicked: true,
  });
}

/**
 * Mark conversion (booking made after campaign)
 */
export async function trackConversion(recipientId, conversionValueCents) {
  return updateCampaignRecipient(recipientId, {
    converted: true,
    conversionValueCents,
    conversionDate: new Date().toISOString(),
  });
}


/**
 * Replace template variables in campaign content
 */
function replaceTemplateVariables(template, variables) {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(placeholder, String(value || ''));
  });
  return result;
}

/**
 * Get campaign list with performance metrics
 */
export async function getCampaignsWithMetrics(parkId, status = null) {
  const campaigns = await getCampaignsByPark(parkId, status);

  const enriched = await Promise.all(campaigns.map(async (campaign) => {
    const performance = await getCampaignPerformance(campaign.id);
    return {
      ...campaign,
      performance: performance || {
        emailsSent: 0,
        emailsOpened: 0,
        openRatePercent: 0,
        conversions: 0,
        conversionRatePercent: 0,
        roiPercent: 0,
        revenueGeneratedCents: 0,
      },
    };
  }));

  return enriched;
}

/**
 * Pause campaign
 */
export async function pauseCampaign(campaignId) {
  return updateCampaign(campaignId, { status: CAMPAIGN_STATUSES.PAUSED });
}

/**
 * Resume paused campaign
 */
export async function resumeCampaign(campaignId) {
  return updateCampaign(campaignId, { status: CAMPAIGN_STATUSES.ACTIVE });
}

/**
 * Complete campaign
 */
export async function completeCampaign(campaignId) {
  return updateCampaign(campaignId, { status: CAMPAIGN_STATUSES.COMPLETED });
}

export { CAMPAIGN_TYPES, CAMPAIGN_STATUSES };
