/**
 * SMS Message Templates
 * Predefined templates for common RV park reservation communications
 */

const SMSTemplates = {
  // Booking confirmation sent immediately after reservation
  BOOKING_CONFIRMATION: {
    type: 'confirmation',
    name: 'Booking Confirmation',
    template: 'Your reservation at {{parkName}} is confirmed! Check-in: {{checkInDate}}. Site: {{siteNumber}}. Reply HELP for questions. {{parkPhone}}',
    variables: ['parkName', 'checkInDate', 'siteNumber', 'parkPhone'],
    priority: 'high',
    sendImmediate: true
  },

  // Pre-arrival reminder (24 hours before check-in)
  PRE_ARRIVAL_REMINDER: {
    type: 'reminder',
    name: 'Pre-Arrival Reminder',
    template: 'Hi {{guestName}}, reminder: you\'re arriving tomorrow at {{parkName}}! Check-in at {{checkInTime}}. Address: {{parkAddress}}. Reply HELP for support.',
    variables: ['guestName', 'parkName', 'checkInTime', 'parkAddress'],
    priority: 'high',
    sendAt: 'checkInDate-24h'
  },

  // Check-in day welcome message (sent at 8am on check-in date)
  CHECKIN_DAY_MESSAGE: {
    type: 'checkin',
    name: 'Check-in Day Welcome',
    template: 'Welcome to {{parkName}}! Your site is {{siteNumber}} at {{parkingLocation}}. Office: {{officeLocation}}. WiFi: {{wifiSSID}} ({{wifiPassword}}). Call {{parkPhone}} for help.',
    variables: ['parkName', 'siteNumber', 'parkingLocation', 'officeLocation', 'wifiSSID', 'wifiPassword', 'parkPhone'],
    priority: 'high',
    sendAt: '8:00 AM'
  },

  // Post-stay thank you with review link (24 hours after checkout)
  POSTSTAY_THANKYOU: {
    type: 'thankyou',
    name: 'Post-Stay Thank You',
    template: 'Thanks for staying at {{parkName}}, {{guestName}}! Please review us: {{reviewLink}}. We hope to see you again soon!',
    variables: ['parkName', 'guestName', 'reviewLink'],
    priority: 'medium',
    sendAt: 'checkOutDate+24h'
  },

  // Payment reminder (for unpaid deposits)
  PAYMENT_REMINDER: {
    type: 'payment',
    name: 'Payment Reminder',
    template: 'Payment reminder: {{amount}} due for your {{parkName}} reservation ({{checkInDate}} - {{checkOutDate}}). Pay here: {{paymentLink}}. Reply HELP for assistance.',
    variables: ['amount', 'parkName', 'checkInDate', 'checkOutDate', 'paymentLink'],
    priority: 'high',
    sendAt: 'immediately'
  },

  // Cancellation confirmation
  CANCELLATION_CONFIRMATION: {
    type: 'cancellation',
    name: 'Cancellation Confirmation',
    template: 'Your reservation at {{parkName}} ({{checkInDate}}) has been cancelled. Refund of {{refundAmount}} will be processed within 3-5 business days. Thank you!',
    variables: ['parkName', 'checkInDate', 'refundAmount'],
    priority: 'high',
    sendImmediate: true
  },

  // Check-out reminder (on checkout date)
  CHECKOUT_REMINDER: {
    type: 'checkout',
    name: 'Check-out Reminder',
    template: 'Hi {{guestName}}, reminder: you\'re checking out of {{parkName}} today! Please depart by {{checkOutTime}}. We\'ve enjoyed having you!',
    variables: ['guestName', 'parkName', 'checkOutTime'],
    priority: 'medium',
    sendAt: '10:00 AM'
  },

  // Special offer/promotional message
  PROMOTIONAL_OFFER: {
    type: 'promotional',
    name: 'Special Offer',
    template: 'Special offer for {{parkName}} guests! {{offerDescription}}. Book now: {{bookingLink}}. Valid until {{offerExpiry}}.',
    variables: ['parkName', 'offerDescription', 'bookingLink', 'offerExpiry'],
    priority: 'low',
    sendAt: 'scheduled'
  },

  // Service alert (weather, facility closure, etc.)
  SERVICE_ALERT: {
    type: 'alert',
    name: 'Service Alert',
    template: 'Alert: {{parkName}} - {{alertMessage}}. For updates: {{contactInfo}}. Thank you for your patience.',
    variables: ['parkName', 'alertMessage', 'contactInfo'],
    priority: 'high',
    sendImmediate: true
  },

  // WiFi/Password notification
  WIFI_CREDENTIALS: {
    type: 'info',
    name: 'WiFi Credentials',
    template: 'WiFi for {{parkName}}, Site {{siteNumber}}: Network: {{wifiSSID}} | Password: {{wifiPassword}}',
    variables: ['parkName', 'siteNumber', 'wifiSSID', 'wifiPassword'],
    priority: 'medium',
    sendImmediate: true
  },

  // Activity/Event notification
  ACTIVITY_NOTIFICATION: {
    type: 'event',
    name: 'Event Notification',
    template: 'Join us at {{parkName}} for {{eventName}}! {{eventTime}} at {{eventLocation}}. {{eventDetails}}',
    variables: ['parkName', 'eventName', 'eventTime', 'eventLocation', 'eventDetails'],
    priority: 'low',
    sendImmediate: true
  },

  // Lost & Found notification
  LOST_AND_FOUND: {
    type: 'notification',
    name: 'Lost & Found',
    template: 'We found {{itemDescription}} at {{parkName}}, Site {{siteNumber}}. Please call {{parkPhone}} to claim your item.',
    variables: ['itemDescription', 'parkName', 'siteNumber', 'parkPhone'],
    priority: 'high',
    sendImmediate: true
  },

  // Generic message (for custom messages)
  CUSTOM_MESSAGE: {
    type: 'custom',
    name: 'Custom Message',
    template: '{{message}}',
    variables: ['message'],
    priority: 'medium',
    sendImmediate: true
  }
};

/**
 * Get template by type
 * @param {string} templateType - Type of template (e.g., 'confirmation', 'reminder')
 * @returns {object} Template object
 */
function getTemplate(templateType) {
  for (const [key, template] of Object.entries(SMSTemplates)) {
    if (template.type === templateType || key === templateType) {
      return template;
    }
  }
  return SMSTemplates.CUSTOM_MESSAGE;
}

/**
 * Render template with variables
 * @param {string} templateType - Type of template
 * @param {object} variables - Variables to fill in template
 * @returns {string} Rendered message
 */
function renderTemplate(templateType, variables = {}) {
  const template = getTemplate(templateType);
  let message = template.template;

  // Replace all {{variable}} placeholders
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    message = message.replace(new RegExp(placeholder, 'g'), value || '');
  }

  return message;
}

/**
 * List all available templates
 * @returns {array} Array of template metadata
 */
function listTemplates() {
  return Object.entries(SMSTemplates).map(([key, template]) => ({
    key,
    type: template.type,
    name: template.name,
    variables: template.variables,
    priority: template.priority,
    template: template.template
  }));
}

/**
 * Validate variables for a template
 * @param {string} templateType - Type of template
 * @param {object} variables - Variables to validate
 * @returns {object} {valid: boolean, missing: array, extra: array}
 */
function validateVariables(templateType, variables = {}) {
  const template = getTemplate(templateType);
  const providedKeys = Object.keys(variables);
  const requiredKeys = template.variables;

  const missing = requiredKeys.filter(key => !providedKeys.includes(key));
  const extra = providedKeys.filter(key => !requiredKeys.includes(key));

  return {
    valid: missing.length === 0,
    missing,
    extra,
    required: requiredKeys
  };
}

module.exports = {
  SMSTemplates,
  getTemplate,
  renderTemplate,
  listTemplates,
  validateVariables
};
