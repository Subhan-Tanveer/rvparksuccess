# White-Label Setup Guide

Enable custom branding for each property in your portfolio. This guide covers color customization, logo uploads, domain setup, and email branding.

## Table of Contents

1. [Overview](#overview)
2. [Brand Colors](#brand-colors)
3. [Logo Upload](#logo-upload)
4. [Custom Domain Setup](#custom-domain-setup)
5. [Email Branding](#email-branding)
6. [CSS Overrides](#css-overrides)
7. [Testing & Deployment](#testing--deployment)
8. [FAQ](#faq)

---

## Overview

White-label branding allows you to customize the appearance of the RVPark Success platform for each property in your portfolio. Guests and staff will see your custom branding instead of the RVPark Success logo and colors.

### What Can Be Customized

- **Logo:** Your park's logo or company brand
- **Colors:** Primary, accent, and background colors
- **Domain:** Custom domain (e.g., `riverside.yourbrand.com`)
- **Company Name:** Displayed in emails and interface
- **Email Footer:** Custom footer with logo and contact info

### What Cannot Be Customized (Currently)

- Page layout or structure
- Core functionality
- Navigation menu structure
- Database or API behavior

---

## Brand Colors

### Primary Color

The primary color appears in:
- Buttons and call-to-action elements
- Links and highlighted text
- Badges and status indicators
- Hover states

**Default:** `#2e9b54` (Green)

**How to Change:**

1. Go to Portfolio Dashboard
2. Select a property
3. Click "Branding Settings" (or access via API)
4. Enter primary color hex code: `#1b4f72`
5. Save changes

**Color Selection Tips:**
- Use high contrast with backgrounds for accessibility
- Test on both light and dark backgrounds
- Ensure color is distinguishable by colorblind users
- Match your existing brand guidelines

### Accent Color

The accent color appears in:
- Secondary buttons
- Decorative elements
- Progress indicators
- Highlight boxes

**Default:** `#d97d2e` (Orange)

**Recommended:** Use a complementary color to your primary color

### Background Color

The background color sets the overall theme:

**Options:**
- Dark: `#0a0a0a` (default, premium feel)
- Light: `#f5f0e8` (clean, airy feel)
- Custom: Any hex code

**Note:** Changing background to light mode requires all text colors to be adjusted for contrast

---

## Logo Upload

### Format Requirements

**Supported Formats:**
- PNG (preferred) — transparent background
- SVG (recommended for scalability)
- JPG (if PNG not available)

**File Size:**
- Maximum 2MB
- Recommended: < 500KB
- Optimized for web

**Dimensions:**
- **Logo:** 200x60px to 400x120px (2:1 aspect ratio)
- **Icon:** 32x32px to 64x64px (square)
- **Full Width:** Up to 1400px wide

### Preparation Steps

1. **Remove Background:**
   - Use transparent PNG for best results
   - White/light backgrounds appear on white surfaces
   - Black/dark backgrounds appear on dark surfaces

2. **Optimize File Size:**
   ```bash
   # Using ImageOptim or similar tool
   pngquant logo.png --output logo-optimized.png
   ```

3. **Test at Different Sizes:**
   - View logo at 32px (navigation bar)
   - View logo at 200px (email footer)
   - View logo at 400px (dashboard header)

### Upload Process

**Via Dashboard:**

1. Go to Portfolio → Select Property → Branding
2. Click "Upload Logo"
3. Select PNG/SVG file
4. Preview thumbnail
5. Click "Save Branding"

**Via API:**

```javascript
// Upload logo as data URI
const logoFile = document.getElementById('logoInput').files[0];
const reader = new FileReader();

reader.onload = async (e) => {
  const logoDataUri = e.target.result;
  
  const response = await fetch('/api/admin/multi-property/branding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parkId: 'park_001',
      branding: {
        logo: logoDataUri,
        companyName: 'Riverside RV Park'
      }
    })
  });
  
  const result = await response.json();
  console.log('Logo uploaded:', result);
};

reader.readAsDataURL(logoFile);
```

### Logo Placement

**Navigation Bar (32x32px):**
- Shown in top-left of every page
- Should have good contrast with dark background
- Icon or compact logo recommended

**Email Footer (200x200px):**
- Included in all automated emails
- Best as centered, full-color logo
- Should work on white email background

**Dashboard Header (400x120px):**
- Optional header branding
- Displayed when property is accessed
- Can include company name or tagline

---

## Custom Domain Setup

### How It Works

Custom domains allow guests to access your branded portal at your own URL:

**Standard URL:**
```
https://app.rvparksuccess.com?parkId=park_001
```

**Custom URL:**
```
https://riverside.yourbrand.com
```

### DNS Configuration

**Step 1: Get CNAME Record**

Contact support or check your account settings for the CNAME record:

```
Property: Riverside RV Park
CNAME Target: app.rvparksuccess.com
```

**Step 2: Add DNS Record**

Update your domain registrar (GoDaddy, Namecheap, etc.):

```
Type: CNAME
Name: riverside
Value: app.rvparksuccess.com
TTL: 3600
```

**Example for different registrars:**

**GoDaddy:**
1. Log in to GoDaddy account
2. Go to DNS Management
3. Add Record → CNAME
4. Name: `riverside`, Value: `app.rvparksuccess.com`
5. Save

**Namecheap:**
1. Log in to Namecheap
2. Go to Domain List → Manage
3. Advanced DNS tab
4. Add Record → CNAME
5. Host: `riverside`, Value: `app.rvparksuccess.com`
6. Save

**CloudFlare:**
1. Log in to CloudFlare
2. DNS tab
3. Add Record → CNAME
4. Name: `riverside`, Target: `app.rvparksuccess.com`
5. Proxy status: DNS only
6. Save

**Step 3: Verify**

Test DNS propagation (may take up to 24 hours):

```bash
# Check DNS resolution
nslookup riverside.yourbrand.com

# Should return app.rvparksuccess.com
```

**Step 4: Update Branding Settings**

In dashboard branding settings, enter custom domain:

```
Custom Domain: riverside.yourbrand.com
```

**Step 5: Test**

Visit the custom domain in a browser:

```
https://riverside.yourbrand.com
```

Should load your branded portal automatically.

### SSL Certificate

Custom domains automatically receive SSL certificates (HTTPS). No additional configuration needed.

Certificate covers:
- `riverside.yourbrand.com`
- `www.riverside.yourbrand.com` (optional)

Certificate is renewed automatically.

---

## Email Branding

### Email Footer

Customize the email footer in all automated emails (confirmations, reminders, receipts):

```html
<div style="text-align: center; padding: 40px 20px; border-top: 1px solid #eee;">
  <img src="[LOGO_URL]" alt="Riverside RV Park" style="width: 120px; margin-bottom: 20px;">
  <p style="margin: 0; color: #666; font-size: 13px;">
    <strong>Riverside RV Park</strong><br>
    123 River Road, Riverside, CA 92501<br>
    <a href="tel:+15551234567" style="color: #2e9b54; text-decoration: none;">+1 (555) 123-4567</a> | 
    <a href="mailto:info@riverside.example.com" style="color: #2e9b54; text-decoration: none;">info@riverside.example.com</a>
  </p>
</div>
```

### Email Color Scheme

Apply your brand colors to email templates:

```javascript
POST /api/admin/multi-property/branding

{
  "parkId": "park_001",
  "branding": {
    "primaryColor": "#1b4f72",
    "accentColor": "#157a72",
    "emailBranding": {
      "footerLogo": "https://...",
      "footerText": "Riverside RV Parks LLC",
      "contactPhone": "+1 (555) 123-4567",
      "contactEmail": "reservations@riverside.example.com",
      "supportUrl": "https://help.riverside.example.com"
    }
  }
}
```

### Email Signature

All staff emails (cancellations, confirmations, support) include:

```
Riverside RV Park
[LOGO]
reservations@riverside.example.com
+1 (555) 123-4567
riverside.example.com
```

---

## CSS Overrides

For advanced customization, you can provide custom CSS that overrides the default styling:

### Available CSS Variables

The platform uses CSS custom properties that can be overridden:

```css
/* Brand Colors */
--primary-color: #2e9b54;
--accent-color: #d97d2e;
--background-color: #0a0a0a;
--surface-color: rgba(245, 240, 232, 0.06);
--text-color: #f5f0e8;
--text-dim: rgba(245, 240, 232, 0.7);

/* Typography */
--font-display: 'Space Grotesk', sans-serif;
--font-body: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;

/* Spacing */
--sp-1: 8px;
--sp-2: 16px;
--sp-3: 24px;
--sp-4: 32px;

/* Radius */
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
```

### Custom CSS Example

```css
/* Override primary button color */
.btn-primary {
  background-color: var(--primary-color);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: var(--sp-2) var(--sp-4);
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover {
  filter: brightness(1.1);
}

/* Custom heading style */
h1, h2, h3 {
  color: var(--primary-color);
  font-family: var(--font-display);
}

/* Branded link color */
a {
  color: var(--primary-color);
  text-decoration: underline;
}

a:hover {
  color: var(--accent-color);
}
```

### Apply Custom CSS

```javascript
PUT /api/admin/multi-property/branding

{
  "parkId": "park_001",
  "branding": {
    "customCss": "/* Your CSS rules here */"
  }
}
```

---

## Testing & Deployment

### Local Testing

1. **In Browser Console:**
   ```javascript
   // Test color override
   document.documentElement.style.setProperty('--primary-color', '#1b4f72');
   ```

2. **Check Multiple Views:**
   - Desktop (1920px wide)
   - Tablet (768px)
   - Mobile (375px)

3. **Test Color Contrast:**
   - Use WebAIM Contrast Checker
   - Ensure WCAG AA compliance (4.5:1 for text)

### Staging Deployment

1. **Set Property to Staging:**
   ```
   Property Settings → Environment: Staging
   ```

2. **Share Staging Link:**
   - Get staging URL from dashboard
   - Share with stakeholders for review
   - Collect feedback

3. **Approve Changes:**
   - Verify all elements match brand guidelines
   - Check email appearance in various clients
   - Confirm mobile display

### Production Deployment

1. **Backup Current Branding:**
   - Screenshot current state
   - Export branding config

2. **Deploy Changes:**
   - Click "Save Branding"
   - Changes take effect immediately
   - Staff and guests see new branding

3. **Monitor:**
   - Check that all surfaces display correctly
   - Monitor email delivery (may take 30 min)
   - Get stakeholder confirmation

### Rollback

If needed, revert to previous branding:

```javascript
PUT /api/admin/multi-property/branding/rollback

{
  "parkId": "park_001"
}
```

---

## FAQ

### Q: Can I use a GIF or animated image as logo?

**A:** Not recommended. Static images (PNG/SVG) work best. Animated GIFs can cause performance issues in emails.

### Q: What if my logo has text built in?

**A:** That's fine. Ensure text is visible at small sizes (32px). Consider having a text-free version for icon placement.

### Q: Can I change branding per site/area, not per property?

**A:** Not currently. Branding is applied per property. Contact support for site-level customization requests.

### Q: How long do color changes take to appear?

**A:** Changes appear immediately on refresh. Browsers may cache CSS, so do a hard refresh (Ctrl+Shift+R).

### Q: Can I use brand fonts other than those provided?

**A:** Custom fonts can be added via CSS, but we recommend system fonts for performance. Font embedding may slow page load.

### Q: Do I need to update emails manually?

**A:** No. Email templates automatically pull branding settings. Changes apply to all future emails.

### Q: What if my domain is already in use?

**A:** Ensure you own the domain or have permission from the owner. CNAME record prevents other use of that subdomain.

### Q: Can guests customize their own branding?

**A:** No. Only property admins can change branding. Guests see the property's branded interface.

### Q: Is there a design template or toolkit?

**A:** Yes, available in account settings → Brand Resources. Includes:
- Color palette files
- Logo usage guidelines
- Email template examples
- Font specifications

### Q: Can I preview changes before deploying?

**A:** Yes, use the Staging environment to test changes before going live to guests.

---

## Support

For branding issues:

- **Email:** support@rvparksuccess.com
- **Documentation:** rvparksuccess.com/docs/branding
- **Video Tutorials:** rvparksuccess.com/tutorials/white-label

Design questions:

- **Brand Strategy:** Submit request for design consultation
- **Custom Features:** Discuss premium white-label options
- **Enterprise Branding:** Custom enterprise plans available
