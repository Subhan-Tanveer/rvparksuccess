# RVPark Success — Website

A from-scratch marketing site for **RVPark Success**, a done-for-you AI marketing service for RV park owners. Built with Vite (multi-page, vanilla JS), GSAP + ScrollTrigger, and Lenis for smooth scroll — same stack pattern as the other client sites in this workspace.

## Getting started

```bash
npm install
npm run dev      # local dev server (http://localhost:5195)
npm run build    # production build -> dist/
npm run preview  # preview the production build
```

## Pages

| Page | File |
|---|---|
| Home | `index.html` |
| Services & Pricing | `packages.html` |
| How It Works (horizontal pinned scroll) | `how-it-works.html` |
| Results | `results.html` |
| Contact / Book a Free Audit | `contact.html` |
| Live Demo (fictional "Best RV Park") | `sample.html` |
| Reservations booking demo | `reservations.html` |

## ⚠️ Everything here is a template — not verified content

- **All stats, testimonials, and the "Best RV Park" pilot case study are illustrative placeholders**, not real, verified numbers. Replace with actual client results as they come in — the copy is written to make swapping easy (search for "Best RV Park" and the stat/counter values in `index.html`, `results.html`).
- **Contact details** (`hello@rvparksuccess.example`, `payments@rvparksuccess.example`, `(850) 555-0199`) are placeholders.
- **No real video/photos are used anywhere** — see the asset list and Gemini prompts below.

## Payment portal

`packages.html`'s "Get Started" flow intentionally does **not** collect card numbers directly anywhere on this site — that's a PCI-compliance/security line that isn't worth crossing when Stripe's own hosted checkout already solves it for free.

- **Stripe Checkout only.** Clicking "Continue to Secure Checkout" calls the Vercel serverless function at `api/create-checkout-session.js`, which creates a Stripe Checkout Session server-side (subscription mode, since all three pricing levels are monthly) and redirects the browser to Stripe's own hosted payment page. Card details never touch this codebase. PayPal and Zelle options were intentionally removed — Stripe is the only payment method offered.

### Stripe setup (one-time, done by you — not by an AI assistant)

1. Create a [Stripe account](https://dashboard.stripe.com/register) if you don't have one.
2. In the Stripe Dashboard, grab your **secret key** — Developers → API keys → "Secret key" (starts with `sk_test_...` for testing, `sk_live_...` for real charges). **Never paste this into a chat, commit it to git, or put it in any file in this repo.**
3. Deploy this project to Vercel (connect the GitHub repo, or `vercel` CLI from this folder).
4. In the Vercel project dashboard: **Settings → Environment Variables** → add `STRIPE_SECRET_KEY` with that secret key as the value. Vercel injects it into `api/create-checkout-session.js` at request time via `process.env.STRIPE_SECRET_KEY` — it's never visible in the deployed frontend code.
5. Test with a `sk_test_...` key and [Stripe's test card numbers](https://docs.stripe.com/testing) first. Switch to `sk_live_...` only once you've confirmed a full test purchase works end-to-end.
6. To test the `/api` function locally before deploying, use `npx vercel dev` instead of `npm run dev` (plain Vite has no serverless runtime, so `/api/create-checkout-session` will fail under `npm run dev` — the button shows an "unavailable" message and re-enables itself in that case, this is expected until you deploy or run `vercel dev`).

Prices are hardcoded in two places that must be kept in sync — `src/js/services-data.js` (drives what's displayed on the page) and the `SERVICES` object in `api/create-checkout-session.js` (drives what Stripe actually charges). Update both if pricing changes.

## Reservations system (proof-of-concept — read before relying on it)

`reservations.html` is a working demo of the "bundle a real reservations system into the monthly marketing package" idea — a guest can search real availability, pick a site, and pay through Stripe, for the fictional "Best RV Park" seeded in `api/_lib/reservations-store.js`.

**This is a proof of concept, not a production booking platform yet.** The one thing to understand before showing this to a real park owner or taking a real booking:

- **The data layer is a JSON file, not a real database.** `api/_lib/reservations-store.js` reads/writes `data/reservations-db.json` on disk. That works correctly for local testing (`vercel dev` on your own machine, where the filesystem is real and persists), but **will not reliably prevent double-bookings once deployed to Vercel** — production serverless functions run in ephemeral, isolated instances with a read-only filesystem, so two guests could both see the same site as available at the same time. Before this handles real money and real reservations, swap the read/write functions in that file for calls to a real database (Vercel Postgres, Supabase, etc.) — the rest of the code (the API routes, the booking page) calls a stable set of functions from that one file and won't need to change.
- **Who holds the guest's money is still an open decision.** Right now, Stripe Checkout collects payment into *your* Stripe account (the same `STRIPE_SECRET_KEY` used for the marketing subscriptions). For a real multi-park platform, the standard approach is **Stripe Connect** — each park connects its own Stripe account, the guest pays the park directly, and RVPark Success's booking-fee cut is deducted automatically. That's a bigger Stripe setup step (and a business decision about money flow) that hasn't been wired up yet.
- **GoHighLevel (GHL) isn't connected yet.** The plan discussed with Marie was for confirmed reservations to flow into GHL (as a contact + a record of the booking) so existing marketing automations — review requests, upsell follow-ups — pick guests up automatically. That sync doesn't exist yet; it's a follow-on step once you confirm which GHL sub-account this should write to.

### How the booking flow works today

1. Guest picks check-in/check-out dates on `reservations.html` and clicks **Check Availability** → calls `GET /api/reservations/availability`, which checks every site at the park against existing confirmed/pending reservations for date overlap and returns what's actually open, with pricing.
2. Guest picks a site, enters their name/email/phone, and clicks **Continue to Secure Checkout** → calls `POST /api/reservations/create-checkout`, which creates a `pending` reservation (holding that site for 20 minutes so two guests can't double-book it mid-checkout) and returns a Stripe Checkout URL.
3. Guest pays on Stripe's hosted page. Stripe then calls `POST /api/reservations/webhook`, which is the **only** thing that flips the reservation to `confirmed` — the booking page itself never marks a reservation paid, so a guest closing the tab mid-checkout can't fake a confirmed booking.

### Setup to actually test payment end-to-end

In addition to the `STRIPE_SECRET_KEY` setup above, the webhook needs its own secret:

1. In the Stripe Dashboard: **Developers → Webhooks → Add endpoint**, pointed at `https://yourdomain.com/api/reservations/webhook`, listening for the `checkout.session.completed` event.
2. Stripe gives you a **signing secret** (starts with `whsec_...`). Add it as `STRIPE_WEBHOOK_SECRET` in the same place you added `STRIPE_SECRET_KEY` (Vercel dashboard → Environment Variables, or your local `.env` for `vercel dev` testing). **Never paste this into a chat, commit it to git, or put it in any file in this repo.**
3. To test locally with `vercel dev`, use the [Stripe CLI](https://docs.stripe.com/stripe-cli) (`stripe listen --forward-to localhost:3000/api/reservations/webhook`) to forward webhook events to your machine — it will print a `whsec_...` value to use locally.

### Multi-park support + staff/admin dashboards

There are now two admin roles, each with their own login:

- **Platform admin (`admin-login.html` → `admin-dashboard.html`)** — this is you. Log in and create a new client park, choosing its name, location, and the login username/password its staff will use. This is not linked from the public site navigation on purpose — bookmark the URL yourself.
- **Park staff (`park-login.html` → `park-dashboard.html`)** — the credentials you set when creating that park. From there staff can add/edit/remove their own sites and rates, and — this is the piece we discussed — enter a phone or walk-in booking directly. A staff-entered booking writes to the *exact same* data a guest's online booking does, so a site is instantly unavailable everywhere the moment either one is entered; there's no separate calendar to keep in sync. `find-a-park.html`/`reservations.html` (the public side) and `park-dashboard.html` (the staff side) are reading and writing the same underlying reservations.

The 3 demo parks seeded in `api/_lib/reservations-store.js` already have a staff login for testing: username is the park's id (`best-rv-park`, `cedar-bend`, or `blue-ridge`), password is `demo1234` for all three.

**Setup — two new environment variables, same rules as the Stripe ones (set in Vercel, never in a file in this repo):**

1. `ADMIN_SESSION_SECRET` — any long random string; it signs the login session cookies. Generate one yourself (e.g. `openssl rand -hex 32`) rather than using something guessable.
2. `SUPER_ADMIN_PASSWORD` — the password for *your* platform-admin login (`admin-login.html`). Pick your own; there's no username, just this one password.

**Same database caveat as the rest of this system applies here too** — park accounts, sites, and staff-entered bookings all live in the same JSON-file store documented above, so none of this is safe to rely on in production until that's replaced with a real database. It's real, working logic — it's the storage underneath it that still needs to change before this handles a real client's real business.

## Contact form → real email (Gmail SMTP)

`contact.html`'s "Book a Free Audit" form sends real email via `api/send-audit-request.js` (Nodemailer over Gmail SMTP) — one notification to `marie@rvparksales.com`, one confirmation to whoever submitted the form. Falls back to a `mailto:` link if the API call fails (e.g. running under plain `npm run dev`, or Gmail rejects the send).

### Gmail setup (one-time, done by you — not by an AI assistant)

1. On the Google account that should send these emails, turn on 2-Step Verification if it isn't already (required for App Passwords).
2. Go to Google Account → Security → 2-Step Verification → **App passwords**, and generate one for this project.
3. **Never paste that password into a chat, commit it to git, or put it in any file in this repo.** Copy it directly from Google into Vercel.
4. In the Vercel project dashboard: **Settings → Environment Variables** → add:
   - `GMAIL_USER` — the full Gmail address (e.g. `marie@rvparksales.com`)
   - `GMAIL_APP_PASSWORD` — the 16-character App Password from step 2
5. To test the `/api` function locally before deploying, use `npx vercel dev` (plain `npm run dev` has no serverless runtime — the form falls back to `mailto:` in that case, which is expected).
6. If an App Password is ever pasted somewhere it shouldn't be (a chat, a screenshot, a shared doc), regenerate it from the same Google Account page — old App Passwords can be revoked individually without affecting the main account password.

The notification recipient (`marie@rvparksales.com`) is hardcoded in `api/send-audit-request.js` — change the `NOTIFY_EMAIL` constant there if it should go elsewhere.

## Placeholder video & images — replace before launch

| Path | Used on | Notes |
|---|---|---|
| `public/video/hero-scrub.mp4` | Home hero, scroll-scrubbed | Until this exists, the `poster` image below shows as a static hero (graceful fallback — see Animation notes) |
| `public/images/hero/hero-poster.jpg` | Home hero poster / fallback | 1920×1080+ landscape |
| `public/images/case-study/best-rv-park-before.jpg` | (optional, add if doing a before/after slider) | 1200×900 |
| `public/images/case-study/best-rv-park-after.jpg` | Results page case study | 1200×900 — falls back to a generated placeholder if missing |
| `public/images/results/dashboard.jpg` | (optional — the dashboard is currently a live CSS/JS mockup, not an image) | 1600×1000 |
| `public/images/misc/results-proof.jpg` | (not yet placed — see prompt below, add wherever you want a proof photo) | 1200×900 |

## Gemini image-generation prompts

Exactly as specified for this build — run these through Gemini (or Grok) and drop the results at the paths above:

**Hero poster image:**
```
Aerial drone shot of a large RV park at golden hour sunset, warm amber light, rows of RVs, trees surrounding, cinematic, photorealistic
```

**Before park:**
```
Rundown RV park with low occupancy, empty sites, dated signage, overcast sky, realistic photo
```

**After park:**
```
Thriving busy RV park full of RVs, families, string lights, golden hour, vibrant and welcoming, aerial view
```

**Dashboard (reference only — the live dashboard on `results.html` is built in pure CSS/JS, not an image):**
```
Clean modern analytics dashboard showing occupancy rate climbing from 45% to 78%, dark theme, amber accents
```

**Results proof:**
```
Happy RV park owner couple standing in front of their park with sold sign, smiling, sunset background
```

## Image-to-video prompt (hero scroll-scrub clip)

1. Generate the hero poster image above.
2. Feed it into an image-to-video tool with a slow, steady motion prompt, e.g.:
   > *Extremely slow, subtle drone push-in over this RV park at golden hour, gentle movement only, no camera shake, cinematic and calm, 6–8 seconds*
3. Export as `.mp4`, save to `public/video/hero-scrub.mp4`. The scroll-scrub JS (`src/js/home.js`) already ties `video.currentTime` to scroll position once the file loads — no code changes needed.

## Animation implementation notes

- **Smooth scroll**: Lenis via GSAP ticker (`src/js/core.js`), skipped under `prefers-reduced-motion`.
- **Hero letter animation**: manual character-splitting utility (`splitChars` in `core.js`) — **not** GSAP SplitText, which is a paid Club GreenSock plugin not available here. Same visual result (per-letter stagger), no license dependency.
- **Hero video scroll-scrub**: `ScrollTrigger`-driven, ties `video.currentTime` to scroll progress across the hero. Falls back to the static `poster` image until a real video file is present.
- **Glitch/scramble text** (`data-glitch` attribute): resolves from random characters into the final word on scroll entry.
- **Typewriter** (`data-typewriter` attribute): types out text character by character on scroll entry.
- **Heading stagger** (`data-split-in="words"` or `"chars"`): splits and staggers in on scroll entry.
- **Animated underline** (`.underline-draw` class): draws left-to-right via a CSS custom property flipped by `IntersectionObserver`.
- **Counters** (`[data-counter]`): count up from 0 on scroll entry.
- **Magnetic buttons** (`.magnetic` class, wrap button text in `<span>`): the element follows the cursor within its bounds, springs back on mouseleave. Disabled on touch devices.
- **3D tilt cards** (`.tilt-card` class): rotate toward cursor position on mousemove. Disabled on touch devices.
- **Custom cursor**: dot + ring, ring scales up over links/buttons/`[data-cursor-hover]`. Hidden entirely on touch devices and under `prefers-reduced-motion`.
- **Horizontal pinned scroll** (How It Works page): `ScrollTrigger` pins the section and translates the track horizontally as the user scrolls vertically; on mobile (≤720px) and under `prefers-reduced-motion`, it automatically falls back to a normal vertical stack — no separate mobile build needed.
- **Occupancy graph, dashboard mockup**: pure CSS/JS, bars animate to height on scroll entry.
- **Scroll progress bar**: fixed top bar reflecting page scroll position.
- **Particles**: decorative floating dots on dark sections (`.particles` wrapper), reduced count on touch devices, static under `prefers-reduced-motion`.

## Content still needed from the client

- Real logo (currently a text wordmark + generated favicon mark)
- Verified pilot/case-study data to replace the Best RV Park placeholder
- Real Stripe payment details (see the Stripe setup steps above)
- Confirmed package feature lists and pricing (currently mirrors the brief exactly: Starter $497, Growth $697, Premium $997)

## Known scope not covered

- No CMS/backend — static site, edit HTML/JS directly.
- Contact/audit form uses a `mailto:` fallback (client-side only). For automated inbox capture, wire `src/js/contact.js` to a form backend (Formspree, Netlify Forms, etc.).
- No image/video compression pipeline — compress real assets before adding to `public/`.
