# Stripe Test Mode - Payment Testing Guide

## 🚀 Quick Start

### Step 1: Get Your Stripe Test Keys

1. Go to **https://dashboard.stripe.com/test/apikeys**
2. Sign in (or create free Stripe account)
3. Copy your **Secret Key** (starts with `sk_test_`)
4. Copy your **Publishable Key** (starts with `pk_test_`)

### Step 2: Add Keys to .env.local

```bash
# File: .env.local

STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
STRIPE_PUBLIC_KEY=pk_test_YOUR_PUBLISHABLE_KEY_HERE
```

### Step 3: Restart Dev Server

```bash
# Kill current server (Ctrl+C)
# Restart:
npm run dev
```

The server will pick up your .env.local keys automatically.

---

## 💳 Test Cards for Payment Testing

### Successful Payment
- **Card:** `4242 4242 4242 4242`
- **Expiry:** Any future date (e.g., 12/25)
- **CVC:** Any 3 digits (e.g., 123)
- **Result:** ✅ Charge succeeds

### Declined Card (Test Failure)
- **Card:** `4000 0000 0000 0002`
- **Expiry:** Any future date
- **CVC:** Any 3 digits
- **Result:** ❌ Charge declined

### 3D Secure / Authentication Required
- **Card:** `4000 0025 0000 3155`
- **Expiry:** Any future date
- **CVC:** Any 3 digits
- **Result:** ⚠️ Requires additional authentication

### International Card (Non-USD)
- **Card:** `5555 5555 5555 4444`
- **Expiry:** Any future date
- **CVC:** Any 3 digits
- **Result:** ✅ Succeeds (Mastercard)

---

## 🧪 Testing Payment Flow

### Test Full Payment Flow

1. **Start dev server**
   ```bash
   npm run dev
   ```
   Opens at: http://localhost:5173

2. **Sign up as park owner**
   - Go to homepage
   - Click "Log In" → "Owner" tab
   - Fill signup form
   - You'll be redirected to **Packages page**

3. **Choose a plan**
   - Click "Get Started" on any plan
   - You'll go to Stripe Checkout

4. **Enter test card**
   - Card: `4242 4242 4242 4242`
   - Expiry: `12/25` (any future date)
   - CVC: `123` (any 3 digits)
   - Name: Any name
   - Email: Any email

5. **Complete payment**
   - Click "Pay" button
   - ✅ Should show success
   - You'll be redirected to **Register Your Park page**

6. **Register park**
   - Fill in Park Name, Location
   - Click "Register Park"
   - ✅ Should go to **Park Dashboard**

---

## 📊 Verify Payment in Stripe Dashboard

After each test payment:

1. Go to **https://dashboard.stripe.com/test/payments**
2. You should see your test charge listed
3. Status should show "Succeeded"
4. Amount should match what you paid

---

## 🐛 Troubleshooting

### Issue: "Invalid API Key"
**Solution:** Check that you copied the FULL key from Stripe dashboard. It should be 50+ characters long.

### Issue: "Card Declined" on 4242 card
**Solution:** Make sure you're in **TEST mode** on Stripe dashboard (top left toggle). Live keys won't work with test cards.

### Issue: Environment variables not loading
**Solution:** 
- Make sure file is named `.env.local` (not `.env`)
- Restart dev server after creating/editing .env.local
- Check that variables are set: `echo $STRIPE_SECRET_KEY`

### Issue: "Stripe not found" error in console
**Solution:** Verify STRIPE_PUBLIC_KEY is set in .env.local and dev server restarted.

---

## 🔒 Important Security Notes

⚠️ **Never commit real keys to GitHub!**
- `.env.local` is in `.gitignore` and won't be committed
- Always use TEST keys (`sk_test_*`, `pk_test_*`) for development
- For production, set keys as Vercel Environment Variables

---

## 📋 Checklist: Test Mode Setup

- [ ] Have Stripe account (free at stripe.com)
- [ ] Copied Secret Key from Stripe dashboard
- [ ] Copied Publishable Key from Stripe dashboard
- [ ] Created `.env.local` file with keys
- [ ] Dev server restarted
- [ ] Test payment with 4242 card succeeds
- [ ] Payment appears in Stripe dashboard
- [ ] Ready to test full payment flow!

---

## 🎯 What to Test

| Feature | How to Test |
|---------|------------|
| **Signup Flow** | Go to login, sign up as owner |
| **Plan Selection** | Choose a plan, go to Stripe checkout |
| **Payment Processing** | Enter test card, complete payment |
| **Post-Payment** | Should redirect to register-park page |
| **Error Handling** | Try declined card (4000 0000 0000 0002) |
| **Different Plans** | Test Foundation, Growth, Maximum plans |
| **Plan Persistence** | Login again, should show active plan |

---

## 📞 Need Help?

If payments aren't working:
1. Check .env.local has both STRIPE_SECRET_KEY and STRIPE_PUBLIC_KEY
2. Verify you're using TEST keys (start with `sk_test_` and `pk_test_`)
3. Restart dev server
4. Check Stripe dashboard for error messages
5. Check browser console (F12) for JavaScript errors

---

**Test Mode is fully isolated from live payments. No real money is charged when using test cards!** ✅
