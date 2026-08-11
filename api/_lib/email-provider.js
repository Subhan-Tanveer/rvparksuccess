// Email provider abstraction — supports Sendgrid, Mailgun, or Nodemailer
// Auto-detects which provider to use based on environment variables and park config

import nodemailer from 'nodemailer';

// Initialize Sendgrid if available
let sendgridClient = null;
if (process.env.SENDGRID_API_KEY) {
  try {
    // Dynamic import for optional dependency
    const sgMail = await import('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    sendgridClient = sgMail;
  } catch (err) {
    console.warn('Sendgrid not available:', err.message);
  }
}

// Initialize Mailgun if available
let mailgunClient = null;
if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
  try {
    const Mailgun = await import('mailgun.js');
    const FormData = await import('form-data');
    mailgunClient = new Mailgun.default(FormData.default).client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
    });
  } catch (err) {
    console.warn('Mailgun not available:', err.message);
  }
}

// Initialize Nodemailer
let transporter = null;
if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
}

/**
 * Send email via configured provider
 * Falls back to next provider if one fails
 */
export async function sendEmail(options) {
  const { to, subject, html, text, provider = 'auto', from, fromName } = options;

  // Validate required fields
  if (!to || !subject || (!html && !text)) {
    throw new Error('Missing required email fields: to, subject, html/text');
  }

  const fromEmail = from || process.env.EMAIL_FROM || 'bookings@rvparksuccess.com';
  const fromHeader = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  // Try providers in order of preference/availability
  const providers = provider === 'auto'
    ? ['sendgrid', 'mailgun', 'nodemailer']
    : [provider];

  let lastError = null;

  for (const providerName of providers) {
    try {
      switch (providerName) {
        case 'sendgrid':
          if (sendgridClient) {
            return await sendViaSendgrid(sendgridClient, { to, subject, html, text, fromHeader, fromEmail, fromName });
          }
          break;

        case 'mailgun':
          if (mailgunClient) {
            return await sendViaMailgun(mailgunClient, { to, subject, html, text, from: fromEmail, fromName });
          }
          break;

        case 'nodemailer':
          if (transporter) {
            return await sendViaNodemailer(transporter, { to, subject, html, text, from: fromHeader });
          }
          break;

        default:
          throw new Error(`Unknown email provider: ${providerName}`);
      }
    } catch (err) {
      lastError = err;
      console.warn(`Failed to send via ${providerName}: ${err.message}`);
      continue;
    }
  }

  // All providers failed
  throw lastError || new Error('No email provider configured');
}

/**
 * Send via Sendgrid
 */
async function sendViaSendgrid(client, options) {
  const { to, subject, html, text, fromHeader, fromEmail, fromName } = options;

  const msg = {
    to,
    from: fromHeader,
    subject,
    html,
    text: text || null,
    // Track opens and clicks
    trackingSettings: {
      clickTracking: { enabled: true },
      openTracking: { enabled: true },
    },
  };

  try {
    const response = await client.send(msg);
    const [data] = response;

    return {
      messageId: data.headers['x-message-id'] || data.id,
      status: 'sent',
      provider: 'sendgrid',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`Sendgrid error: ${err.message}`);
  }
}

/**
 * Send via Mailgun
 */
async function sendViaMailgun(client, options) {
  const { to, subject, html, text, from, fromName } = options;
  const domain = process.env.MAILGUN_DOMAIN;

  if (!domain) {
    throw new Error('MAILGUN_DOMAIN not configured');
  }

  const fromHeader = fromName ? `${fromName} <${from}>` : from;

  try {
    const response = await client.messages.create(domain, {
      from: fromHeader,
      to,
      subject,
      html,
      text: text || null,
      'o:tracking': true,
      'o:tracking-opens': 'yes',
      'o:tracking-clicks': 'yes',
    });

    return {
      messageId: response.id,
      status: 'sent',
      provider: 'mailgun',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`Mailgun error: ${err.message}`);
  }
}

/**
 * Send via Nodemailer
 */
async function sendViaNodemailer(transporter, options) {
  const { to, subject, html, text, from } = options;

  try {
    const response = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text: text || null,
    });

    return {
      messageId: response.messageId,
      status: 'sent',
      provider: 'nodemailer',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`Nodemailer error: ${err.message}`);
  }
}

/**
 * Get available providers
 */
export function getAvailableProviders() {
  const available = [];

  if (sendgridClient) available.push({ name: 'sendgrid', label: 'Sendgrid' });
  if (mailgunClient) available.push({ name: 'mailgun', label: 'Mailgun' });
  if (transporter) available.push({ name: 'nodemailer', label: 'SMTP (Nodemailer)' });

  return available;
}

/**
 * Test email configuration
 */
export async function testEmailConfiguration(provider = 'auto') {
  try {
    const result = await sendEmail({
      to: process.env.TEST_EMAIL || 'test@example.com',
      subject: 'RVPark Success — Email Configuration Test',
      html: '<p>If you see this, your email configuration is working!</p>',
      provider,
    });
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export { sendgridClient, mailgunClient, transporter };
