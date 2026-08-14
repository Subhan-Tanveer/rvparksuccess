#!/usr/bin/env node
// Test webhook script — simulates Stripe webhook for local testing
import crypto from 'crypto';

const WEBHOOK_SECRET = 'whsec_test_732fb0559a8e5891d40fb19f0254e66d48643cda';
const WEBHOOK_URL = 'http://localhost:3000/api/reservations/webhook';

// Mock Stripe webhook event for subscription checkout
const mockEvent = {
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_' + crypto.randomBytes(10).toString('hex'),
      mode: 'subscription',
      client_reference_id: 'subiland', // Park ID from earlier signup
      customer: 'cus_test_' + crypto.randomBytes(10).toString('hex'),
      subscription: 'sub_test_' + crypto.randomBytes(10).toString('hex'),
      metadata: {
        type: 'subscription',
        service: 'foundation', // or 'growth', 'maximum'
      },
    },
  },
};

// Create Stripe-compatible signature
const payload = JSON.stringify(mockEvent);
const timestamp = Math.floor(Date.now() / 1000);
const signedContent = `${timestamp}.${payload}`;
const signature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(signedContent)
  .digest('base64');
const stripeSignature = `t=${timestamp},v1=${signature}`;

// Send webhook
console.log('📤 Sending test webhook to', WEBHOOK_URL);
console.log('Park ID:', mockEvent.data.object.client_reference_id);
console.log('Plan:', mockEvent.data.object.metadata.service);

fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'stripe-signature': stripeSignature,
    'content-type': 'application/json',
  },
  body: payload,
})
  .then((r) => r.json())
  .then((d) => {
    console.log('✅ Webhook received:', d);
    console.log('\n🎉 Check your dashboard now! planKey should be saved.');
  })
  .catch((e) => console.error('❌ Error:', e.message));
