// Thin client for BazaarLink's OpenAI-compatible chat completions endpoint —
// used to turn numbers we already computed (rate suggestions, occupancy
// forecasts, analytics KPIs) into a short plain-English summary. The
// underlying prediction/optimization stays statistical (RateOptimizer,
// analytics-engine); this only narrates results that already exist, it
// never generates the numbers itself.
const BASE_URL = process.env.BAZAARLINK_BASE_URL || 'https://api.bazaarlink.ai/v1';
const MODEL = process.env.BAZAARLINK_MODEL || 'deepseek/deepseek-v4-flash:free';

export async function generateNarrative(systemPrompt, userPrompt) {
  const apiKey = process.env.BAZAARLINK_API_KEY;
  if (!apiKey) throw new Error('AI insights are not configured (BAZAARLINK_API_KEY missing) — see README.');

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 220,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // Log the raw provider response for debugging, but never surface it
    // to the dashboard — a park owner shouldn't see a wall of upstream
    // JSON ("invalid_request_error", HTTP codes) for what's just "this
    // account needs billing attention" or "try again."
    console.error(`AI insight request failed (HTTP ${response.status}):`, text.slice(0, 500));
    if (response.status === 402) {
      throw new Error('AI insights are temporarily unavailable — the BazaarLink account needs more credits. Contact your administrator.');
    }
    throw new Error('AI insights are temporarily unavailable. Please try again in a moment.');
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('AI insight response had no content');
  return content;
}
