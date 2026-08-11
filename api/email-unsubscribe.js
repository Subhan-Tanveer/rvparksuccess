// GET /api/email-unsubscribe — public unsubscribe endpoint
// Guests click this link from every email to opt out
// Takes ?email=X&park=Y&token=Z to verify legitimacy without requiring login

import { unsubscribeEmail, isUnsubscribed } from './_lib/email-scheduler.js';
import { getPark } from './_lib/reservations-store.js';

// Simple HMAC-based token to prevent abuse (verify emails belong to the park)
function generateUnsubscribeToken(email, parkId, secret = process.env.UNSUBSCRIBE_TOKEN_SECRET || 'change-me') {
  const crypto = await import('crypto');
  return crypto.createHmac('sha256', secret).update(`${email}:${parkId}`).digest('hex');
}

export default async function handler(req, res) {
  // Support both GET (link clicks) and POST (form submission)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, park: parkId, token, reason = 'link-click' } = req.method === 'GET' ? req.query : req.body;

  if (!email || !parkId) {
    return res.status(400).json({ error: 'Missing email or park ID' });
  }

  try {
    // Verify token if provided (optional but recommended for security)
    if (token) {
      const expectedToken = generateUnsubscribeToken(email, parkId);
      if (token !== expectedToken) {
        return res.status(403).json({ error: 'Invalid unsubscribe token' });
      }
    }

    // Verify park exists
    const park = await getPark(parkId);
    if (!park) {
      return res.status(404).json({ error: 'Park not found' });
    }

    // Check if already unsubscribed
    const alreadyUnsubscribed = await isUnsubscribed(email, parkId);

    // Add to unsubscribe list
    await unsubscribeEmail(email, parkId, reason);

    // For GET requests, return HTML confirmation page
    if (req.method === 'GET') {
      const message = alreadyUnsubscribed
        ? 'You were already unsubscribed.'
        : 'You have been unsubscribed from emails.';

      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Unsubscribe Confirmation</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                background-color: #f5f5f5;
                padding: 40px 20px;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                text-align: center;
              }
              h1 {
                color: #333;
                margin-bottom: 20px;
              }
              p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 20px;
              }
              .success {
                color: #2e9b54;
              }
              a {
                color: #2e9b54;
                text-decoration: none;
                font-weight: 500;
              }
              a:hover {
                text-decoration: underline;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Unsubscribe Confirmation</h1>
              <p class="success">${message}</p>
              <p>We're sorry to see you go. If you change your mind, you can always resubscribe through your account.</p>
              <p>
                <a href="https://www.rvparksuccess.com">Back to RVPark Success</a>
              </p>
            </div>
          </body>
        </html>
      `);
    }

    // For POST requests, return JSON
    return res.status(200).json({
      success: true,
      message: alreadyUnsubscribed ? 'Already unsubscribed' : 'Successfully unsubscribed',
    });
  } catch (err) {
    console.error('Unsubscribe error:', err.message);

    if (req.method === 'GET') {
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Error</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                background-color: #f5f5f5;
                padding: 40px 20px;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                text-align: center;
              }
              h1 {
                color: #d32f2f;
                margin-bottom: 20px;
              }
              p {
                color: #666;
                line-height: 1.6;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Error Processing Unsubscribe</h1>
              <p>Sorry, we encountered an error processing your unsubscribe request.</p>
              <p>Please try again later or contact support.</p>
            </div>
          </body>
        </html>
      `);
    }

    return res.status(500).json({ error: 'Failed to process unsubscribe' });
  }
}
