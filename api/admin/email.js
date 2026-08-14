// POST /api/admin/email — email marketing management for park staff
// Handles template sending, campaign management, unsubscribe management, and metrics

import { requireSession } from '../_lib/auth.js';
import { getPark, getReservationsForPark } from '../_lib/reservations-store.js';
import {
  getEmailStats,
  getEmailLogs,
  unsubscribeEmail,
  createEmailLog,
  isUnsubscribed,
} from '../_lib/email-scheduler.js';
import {
  sendPreArrivalEmail,
  sendPostStayEmail,
  sendRecoveryEmail,
  sendSeasonalPromoEmail,
} from '../_lib/email-automation.js';
import { sendEmail, getAvailableProviders } from '../_lib/email-provider.js';
import { getTemplate, TEMPLATE_TYPES } from '../_lib/email-templates.js';

export default async function handler(req, res) {
  const session = requireSession(req, res, { role: 'park-staff' });
  if (!session) return;

  const { action } = req.body || {};

  try {
    // GET /api/admin/email — fetch email stats and configuration
    if (req.method === 'GET') {
      const park = await getPark(session.parkId);
      if (!park) return res.status(404).json({ error: 'Park not found' });

      const stats = await getEmailStats(session.parkId);
      const logs = await getEmailLogs(session.parkId, 10);
      const providers = getAvailableProviders();

      return res.status(200).json({
        park: {
          emailsEnabled: park.emailsEnabled,
          emailProvider: park.emailProvider,
          senderEmail: park.senderEmail,
          senderName: park.senderName,
          emailPreArrival: park.emailPreArrival,
          emailPostStay: park.emailPostStay,
          emailRecovery: park.emailRecovery,
          emailPromo: park.emailPromo,
          loyaltyDiscountPercent: park.loyaltyDiscountPercent,
        },
        stats,
        recentLogs: logs,
        availableProviders: providers,
      });
    }

    // POST — handle actions
    if (req.method === 'POST') {
      const park = await getPark(session.parkId);
      if (!park) return res.status(404).json({ error: 'Park not found' });

      // Send template to specific reservation
      if (action === 'send-template') {
        const { reservationId, templateType } = req.body;

        if (!reservationId || !templateType) {
          return res.status(400).json({ error: 'Missing reservationId or templateType' });
        }

        const reservations = await getReservationsForPark(session.parkId);
        const reservation = reservations.find((r) => r.id === reservationId);
        if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

        let result;
        switch (templateType) {
          case TEMPLATE_TYPES.PRE_ARRIVAL:
            result = await sendPreArrivalEmail(reservation, park, null);
            break;
          case TEMPLATE_TYPES.POST_STAY:
            result = await sendPostStayEmail(reservation, park);
            break;
          case TEMPLATE_TYPES.RECOVERY:
            result = await sendRecoveryEmail(reservation, park);
            break;
          default:
            return res.status(400).json({ error: 'Unknown template type' });
        }

        if (!result.sent) {
          return res.status(400).json({ error: 'Failed to send email', reason: result.reason });
        }

        return res.status(200).json({ success: true, messageId: result.messageId });
      }

      // Send seasonal promo to all guests
      if (action === 'send-promo') {
        const { title, description, code, details, endDate } = req.body;

        if (!title || !code) {
          return res.status(400).json({ error: 'Missing required fields: title, code' });
        }

        const result = await sendSeasonalPromoEmail(session.parkId, {
          title,
          description,
          code,
          details,
          endDate,
        });

        return res.status(200).json({
          success: true,
          campaignId: result.campaignId,
          results: result.results,
        });
      }

      // Preview template with sample data
      if (action === 'preview-template') {
        const { templateType } = req.body;

        const sampleData = {
          guestName: 'John Doe',
          checkInDate: 'Tuesday, August 19, 2026',
          checkInTime: '4:00 PM',
          siteNumber: '12A',
          parkName: park.name,
          address: park.location,
          parkPhone: park.ownerPhone || '(555) 123-4567',
          parkEmail: park.senderEmail || 'bookings@example.com',
          wifiSsid: 'RVPark-Guest',
          wifiPassword: 'welcome123',
          parkingInstructions: 'Drive to lot A. Your space is marked.',
          siteRules: 'No loud music after 10pm. Speed limit 5mph.',
          emergencyPhone: '(555) 911-0000',
          checkOutDate: 'Thursday, August 21, 2026',
          loyaltyDiscountPercent: park.loyaltyDiscountPercent || 15,
          reviewLink: 'https://example.com/review',
          totalPrice: '$299.00',
          promoTitle: 'Labor Day Weekend Special',
        };

        const html = getTemplate(templateType, sampleData);
        return res.status(200).json({ html, templateType });
      }

      // Update park email settings
      if (action === 'update-settings') {
        const { emailsEnabled, emailProvider, senderEmail, senderName, emailPreArrival, emailPostStay, emailRecovery, emailPromo, loyaltyDiscountPercent } = req.body;

        const updates = {};
        if (emailsEnabled !== undefined) updates.emailsEnabled = emailsEnabled;
        if (emailProvider) updates.emailProvider = emailProvider;
        if (senderEmail) updates.senderEmail = senderEmail;
        if (senderName) updates.senderName = senderName;
        if (emailPreArrival !== undefined) updates.emailPreArrival = emailPreArrival;
        if (emailPostStay !== undefined) updates.emailPostStay = emailPostStay;
        if (emailRecovery !== undefined) updates.emailRecovery = emailRecovery;
        if (emailPromo !== undefined) updates.emailPromo = emailPromo;
        if (loyaltyDiscountPercent !== undefined) updates.loyaltyDiscountPercent = loyaltyDiscountPercent;

        // TODO: Update park in database with these settings
        // await updateParkEmailSettings(session.parkId, updates);

        return res.status(200).json({ success: true, updates });
      }

      // Unsubscribe email
      if (action === 'unsubscribe') {
        const { email } = req.body;

        if (!email) {
          return res.status(400).json({ error: 'Missing email' });
        }

        await unsubscribeEmail(email, session.parkId, 'manual-park-request');
        return res.status(200).json({ success: true });
      }

      // Get email logs (paginated)
      if (action === 'get-logs') {
        const { limit = 50, offset = 0 } = req.body;
        const logs = await getEmailLogs(session.parkId, limit, offset);
        return res.status(200).json({ logs });
      }

      // Get detailed stats
      if (action === 'get-stats') {
        const stats = await getEmailStats(session.parkId);
        return res.status(200).json({ stats });
      }

      // Send test email
      if (action === 'test-email') {
        const { testEmail } = req.body;

        if (!testEmail) {
          return res.status(400).json({ error: 'Missing testEmail' });
        }

        try {
          const result = await sendEmail({
            to: testEmail,
            subject: `Test Email from ${park.name} — RVPark Success`,
            html: `
              <p>Hi there!</p>
              <p>This is a test email from your RVPark Success marketing automation system.</p>
              <p><strong>Park:</strong> ${park.name}</p>
              <p><strong>Email Provider:</strong> ${park.emailProvider || 'auto'}</p>
              <p>If you received this, your email configuration is working correctly!</p>
            `,
            provider: park.emailProvider || 'auto',
            from: park.senderEmail || 'bookings@rvparksuccess.com',
            fromName: park.senderName || 'RVPark Success',
          });

          return res.status(200).json({ success: true, result });
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Email API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
