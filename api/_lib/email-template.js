// Shared branded HTML email layout — dark premium theme matching the site
// (near-black background, forest-green card, amber accent, cream text).
// Table-based layout with fully inline styles, since that's what actually
// renders consistently across Gmail/Outlook/Apple Mail, unlike a linked
// stylesheet or even a <style> block (Outlook especially ignores most of
// modern CSS). Not exported as an API route — this file lives under an
// underscore-prefixed folder, which Vercel excludes from routing.
const COLORS = {
  black: '#080c08',
  forest: '#0d1f0f',
  border: '#1f3320',
  amber: '#f5a623',
  cream: '#f5f0e8',
  dim: '#9a9488',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function detailRow(label, value, isLast) {
  const border = isLast ? '' : `border-bottom:1px solid ${COLORS.border};`;
  return `
    <tr>
      <td style="padding:14px 20px; ${border} font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:0.5px; text-transform:uppercase; color:${COLORS.dim};">${escapeHtml(label)}</td>
      <td style="padding:14px 20px; ${border} font-family:'Courier New',Courier,monospace; font-size:14px; color:${COLORS.cream}; text-align:right;">${escapeHtml(value || '—')}</td>
    </tr>`;
}

/**
 * @param {object} opts
 * @param {string} opts.eyebrow - small amber label above the title
 * @param {string} opts.title - main heading
 * @param {string} opts.intro - intro paragraph (plain text, will be escaped)
 * @param {Array<[string,string]>} opts.details - [label, value] rows
 * @param {{label:string, href:string}} [opts.cta] - optional button
 * @param {string} [opts.closing] - optional closing paragraph below the details card
 */
export function renderEmail({ eyebrow, title, intro, details = [], cta, closing }) {
  const rows = details.map(([label, value], i) => detailRow(label, value, i === details.length - 1)).join('');
  const ctaHtml = cta
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
      <tr><td style="background-color:${COLORS.amber}; border-radius:999px;">
        <a href="${cta.href}" style="display:inline-block; padding:14px 30px; font-family:Arial,Helvetica,sans-serif; font-weight:bold; font-size:14px; color:${COLORS.black}; text-decoration:none;">${escapeHtml(cta.label)}</a>
      </td></tr>
    </table>`
    : '';
  const closingHtml = closing
    ? `<p style="margin:24px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.7; color:${COLORS.dim};">${escapeHtml(closing)}</p>`
    : '';

  return `<!doctype html>
<html>
<body style="margin:0; padding:0; background-color:${COLORS.black};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.black};">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:${COLORS.forest}; border-radius:16px; overflow:hidden; border:1px solid ${COLORS.border};">

        <tr><td style="padding:28px 32px; background-color:${COLORS.black}; text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td style="width:32px; height:32px; background-color:${COLORS.amber}; border-radius:8px; text-align:center; vertical-align:middle; font-family:Arial,Helvetica,sans-serif; font-weight:bold; color:${COLORS.black}; font-size:16px;">R</td>
              <td style="padding-left:10px; font-family:Arial,Helvetica,sans-serif; font-weight:bold; font-size:17px; color:${COLORS.cream};">RVPark Success</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:36px 32px 32px;">
          <p style="margin:0 0 8px; font-family:'Courier New',Courier,monospace; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${COLORS.amber}; font-weight:bold;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0 0 16px; font-family:Arial,Helvetica,sans-serif; font-size:23px; font-weight:800; color:${COLORS.cream}; line-height:1.35;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 24px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.65; color:#c9c3b6;">${escapeHtml(intro)}</p>

          ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.black}; border:1px solid ${COLORS.border}; border-radius:12px;">${rows}</table>` : ''}

          ${ctaHtml}
          ${closingHtml}
        </td></tr>

        <tr><td style="padding:20px 32px; background-color:${COLORS.black}; text-align:center; border-top:1px solid ${COLORS.border};">
          <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:${COLORS.dim};">RVPark Success — Done-for-you AI marketing for RV park owners.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
