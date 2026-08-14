// Email tracking endpoints
// GET /api/email-tracking/open — track email opens (pixel)
// GET /api/email-tracking/click — track email clicks

import { trackEmailOpen, trackEmailClick } from './_lib/email-scheduler.js';

export default async function handler(req, res) {
  const { type } = req.query;

  if (!type || !['open', 'click'].includes(type)) {
    return res.status(400).json({ error: 'Invalid tracking type' });
  }

  try {
    // Extract email log ID from request
    const emailLogId = req.query.eid || req.query.emailId || req.body?.emailId;

    if (!emailLogId) {
      // For privacy, don't expose that we need an ID
      // Return 1x1 pixel/redirect anyway so senders don't get errors
      if (type === 'open') {
        // Return a 1x1 transparent GIF pixel for open tracking
        const pixel = Buffer.from([
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
          0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
          0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x0a,
          0x00, 0x01, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
          0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
          0x01, 0x00, 0x3b,
        ]);
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0');
        return res.status(200).end(pixel);
      } else {
        // For click tracking, redirect to default
        return res.redirect(req.query.url || 'https://www.rvparksuccess.com');
      }
    }

    // Track the interaction
    if (type === 'open') {
      await trackEmailOpen(emailLogId);
      // Return 1x1 transparent GIF pixel
      const pixel = Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
        0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
        0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x0a,
        0x00, 0x01, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
        0x01, 0x00, 0x3b,
      ]);
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0');
      return res.status(200).end(pixel);
    } else if (type === 'click') {
      await trackEmailClick(emailLogId);
      // Redirect to final URL
      const url = req.query.url || 'https://www.rvparksuccess.com';
      return res.redirect(302, url);
    }
  } catch (err) {
    console.error('Email tracking error:', err.message);
    // Don't expose error details in response for security
  }

  // Fallback responses
  if (type === 'open') {
    const pixel = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
      0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
      0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x0a,
      0x00, 0x01, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
      0x01, 0x00, 0x3b,
    ]);
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0');
    return res.status(200).end(pixel);
  } else {
    return res.redirect(302, 'https://www.rvparksuccess.com');
  }
}
