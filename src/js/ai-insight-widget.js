// Reusable "AI Insight" card — a button that sends already-computed
// numbers (rate suggestions, occupancy forecasts, analytics KPIs) to
// /api/admin/ops?resource=ai-insight and shows back a short narrative.
// Manual trigger only (never auto-runs on page load) so a limited
// NVIDIA API budget isn't burned on every dashboard visit.

export function renderAiInsightWidget(kind, buttonLabel = 'Generate AI Insight') {
  const wrap = document.createElement('div');
  wrap.className = 'ai-insight-card';
  wrap.innerHTML = `
    <div class="ai-insight-head">
      <span class="ai-insight-badge">AI</span>
      <button type="button" class="btn btn-ghost btn-sm ai-insight-btn"><span>${buttonLabel}</span></button>
    </div>
    <div class="ai-insight-body" style="display:none;"></div>
  `;

  const btn = wrap.querySelector('.ai-insight-btn');
  const body = wrap.querySelector('.ai-insight-body');

  wrap.setBusy = (fn) => {
    btn.addEventListener('click', async () => {
      const context = fn();
      if (!context) return;
      btn.disabled = true;
      body.style.display = 'block';
      body.textContent = 'Thinking…';
      body.classList.remove('is-error');
      try {
        const res = await fetch('/api/admin/ops?resource=ai-insight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, context }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate insight');
        body.textContent = data.insight;
      } catch (err) {
        console.error('AI insight failed:', err);
        body.textContent = err.message || 'Could not generate an insight right now.';
        body.classList.add('is-error');
      } finally {
        btn.disabled = false;
      }
    });
  };

  return wrap;
}
