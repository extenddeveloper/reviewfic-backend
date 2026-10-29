import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { initializeDb, query } from './db.js';
import { searchGooglePlaces, getGooglePlaceDetails } from './services/googlePlaces.js';
import { verifyTrustpilotBusiness, getTrustpilotReviews } from './services/trustpilot.js';
import authRouter, {
  setTeamSignupNotifier,
  setSignupVerificationNotifier,
  setPasswordResetNotifier,
  setTrialStarter,
  resetCodeStore,
  signupCodeStore,
  loginOtpStore,
  socialAuthSessions,
  socialSessionMetadata,
  resolveGoogleRedirectUri,
} from './auth.js';

import {
  forwardToCRMfic,
  forwardToFluentCRM,
  forwardToMailerpress,
  syncUserToCRMfic,
  syncUserToFluentCRM,
  syncUserToMailerpress,
  syncUserToAllCRMs,
  getUserCRMProfile,
  getAllDBContacts,
  getMissedCRMficContacts,
  autoSyncMissedContactsToCRMfic,
  getCRMficSyncStats,
  markContactAsCRMficSynced,
} from './webhookcrm.js';
export {
  forwardToCRMfic,
  forwardToFluentCRM,
  forwardToMailerpress,
  syncUserToCRMfic,
  syncUserToFluentCRM,
  syncUserToMailerpress,
  syncUserToAllCRMs,
  getUserCRMProfile,
  getAllDBContacts,
  getMissedCRMficContacts,
  autoSyncMissedContactsToCRMfic,
  getCRMficSyncStats,
  markContactAsCRMficSynced,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
app.set('trust proxy', 1);
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('your_secret_key')) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  } else {
    console.warn('⚠️ STRIPE_SECRET_KEY is not configured or using placeholder. Stripe routes will operate in dev mode.');
  }
} catch (err) {
  console.warn('⚠️ Could not initialize Stripe:', err.message);
}
const PORT = process.env.PORT || 3000;

function getCleanFromAddress() {
  const candidate = process.env.SMTP_FROM || '';
  const match = String(candidate).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (match) return match[0].trim();

  const userMatch = String(process.env.SMTP_USER || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (userMatch) return userMatch[0].trim();

  return 'hello@framefic.com';
}

const frameficLogoPath = fileURLToPath(new URL('./assets/Framefic.png', import.meta.url));
const frameficAppLogoPath = fileURLToPath(new URL('./assets/Favicon.png', import.meta.url));
const waveImagePath = fileURLToPath(new URL('./assets/wave.png', import.meta.url));

const smtpPort = Number(process.env.SMTP_PORT) || 587;
const isSecure = process.env.SMTP_SECURE === 'true'
  ? (smtpPort === 465)
  : (process.env.SMTP_SECURE === 'false' ? false : smtpPort === 465);

const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: isSecure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendSignupVerificationEmail({ username, email, code }) {
  try {
    const templatePath = path.join(__dirname, 'signup-mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    htmlContent = htmlContent
      .replace(/{username}/g, username || 'there')
      .replace(/{code}/g, String(code))
      .replace(/{year}/g, String(new Date().getFullYear()));

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress(),
      },
      to: email,
      subject: 'Verify your Framefic account email',
      html: htmlContent,
      attachments: [
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
        {
          filename: 'wave.png',
          path: waveImagePath,
          cid: 'wave-image',
        },
      ],
    });
    return true;
  } catch (err) {
    console.error('⚠️ Failed to send verification email via SMTP:', err.message);
    return false;
  }
}

export async function sendPasswordResetEmail({ username, email, code }) {
  try {
    const templatePath = path.join(__dirname, 'mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    htmlContent = htmlContent
      .replace('{title}', 'Reset Password')
      .replace('{header_title}', 'Reset your password')
      .replace('{header_subtitle}', 'Use this verification code to set a new password')
      .replace('{body_text}', 'We received a request to reset your <strong style="color: #8aa2ff; font-weight: 700;">Framefic</strong> account password. Enter the 6-digit code below to proceed. This code expires in <strong style="color: #8aa2ff; font-weight: 700;">15 minutes</strong>.')
      .replace('{username}', username || 'there')
      .replace('{code}', String(code))
      .replace(/{year}/g, String(new Date().getFullYear()));

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress(),
      },
      to: email,
      subject: 'Your Framefic Password Reset Code',
      html: htmlContent,
      attachments: [
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
        {
          filename: 'wave.png',
          path: waveImagePath,
          cid: 'wave-image',
        },
      ],
    });
    return true;
  } catch (err) {
    console.error('⚠️ Failed to send password reset email via SMTP:', err.message);
    return false;
  }
}


// Production-grade request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
  res.on('finish', () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const method = req.method;
    const url = req.originalUrl || req.url;
    const status = res.statusCode;

    let logLevel = 'INFO';
    if (status >= 500) {
      logLevel = 'ERROR';
    } else if (status >= 400) {
      logLevel = 'WARN';
    }

    console.log(`[${timestamp}] ${logLevel}: ${method} ${url} - ${status} (${duration}ms) - IP: ${ip}`);
  });
  next();
});

const PLAN_CATALOG = Object.freeze({
  monthly: { amount: 4.99, currency: 'usd' },
  yearly: { amount: 49.99, currency: 'usd' },
  lifetime: { amount: 99.99, currency: 'usd' },
});

function getPriceMap() {
  return {
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    yearly: process.env.STRIPE_PRICE_YEARLY,
    lifetime: process.env.STRIPE_PRICE_LIFETIME,
  };
}

function getPlanConfig(plan) {
  return PLAN_CATALOG[plan] || null;
}

function toMinorUnits(majorAmount) {
  return Math.round(Number(majorAmount) * 100);
}

function toMajorUnits(minorAmount) {
  if (minorAmount == null) return null;
  return Number((Number(minorAmount) / 100).toFixed(2));
}

// ── Helper functions for webhook ──
function getExpiryDate(plan) {
  const now = new Date();
  if (plan === 'monthly') {
    now.setMonth(now.getMonth() + 1);
    return now.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (plan === 'yearly') {
    now.setFullYear(now.getFullYear() + 1);
    return now.toISOString().slice(0, 19).replace('T', ' ');
  }
  return null;
}

function unixToMySQLDateTime(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const normalized = email.toLowerCase().trim();
  return normalized || null;
}

function getTrialDuration() {
  const envMinutes = process.env.TRIAL_DURATION_MINUTES;
  if (envMinutes && !isNaN(Number(envMinutes))) {
    return { unit: 'minute', value: Number(envMinutes) };
  }
  const envDays = process.env.TRIAL_DURATION_DAYS;
  if (envDays && !isNaN(Number(envDays))) {
    return { unit: 'day', value: Number(envDays) };
  }
  return { unit: 'day', value: 7 }; // Default 7 days
}

function calculateTrialEnd(startDate) {
  const duration = getTrialDuration();
  const end = new Date(startDate);
  if (duration.unit === 'minute') {
    end.setMinutes(end.getMinutes() + duration.value);
  } else {
    end.setDate(end.getDate() + duration.value);
  }
  return end;
}

export async function checkTrialEligibility(email, siteId, framerUserId) {
  const resolvedEmail = normalizeEmail(email);

  // 1. Check if email already has a trial
  if (resolvedEmail) {
    const [emailRows] = await db.query(
      'SELECT id FROM reviewfic_trials WHERE email = ? LIMIT 1',
      [resolvedEmail]
    );
    if (emailRows.length > 0) return { eligible: false, reason: 'This email has already claimed a trial.' };
  }

  // 2. Check if site_id already has a trial (skip generic placeholders like 'framer-cloud' or 'unknown')
  if (siteId && siteId !== 'framer-cloud' && siteId !== 'unknown' && siteId.trim() !== '') {
    const [siteRows] = await db.query(
      'SELECT id FROM reviewfic_trials WHERE site_id = ? LIMIT 1',
      [siteId]
    );
    if (siteRows.length > 0) return { eligible: false, reason: 'This site has already claimed a trial.' };
  }

  // 3. Check if framer_user_id already has a trial
  if (framerUserId) {
    const [userRows] = await db.query(
      'SELECT id FROM reviewfic_trials WHERE framer_user_id = ? LIMIT 1',
      [framerUserId]
    );
    if (userRows.length > 0) return { eligible: false, reason: 'This Framer user has already claimed a trial.' };
  }

  return { eligible: true };
}

export async function startTrial(email, siteId, framerUserId, componentsCount = 0, siteName = null, siteUrl = null) {
  const eligibility = await checkTrialEligibility(email, siteId, framerUserId);
  if (!eligibility.eligible) {
    return { success: false, reason: eligibility.reason };
  }

  const trialStart = new Date();
  const trialEnd = calculateTrialEnd(trialStart);
  const trialStartStr = trialStart.toISOString().slice(0, 19).replace('T', ' ');
  const trialEndStr = trialEnd.toISOString().slice(0, 19).replace('T', ' ');

  await db.query(
    `INSERT INTO reviewfic_trials (email, site_id, site_name, site_url, framer_user_id, trial_start, trial_end, components_added, current_plan_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [normalizeEmail(email), siteId || 'unknown', siteName || null, siteUrl || null, framerUserId || null, trialStartStr, trialEndStr, componentsCount || 0, 'trialing']
  );

  // Sync trial started event to both FluentCRM and CRMfic
  syncUserToAllCRMs(email, 'TRIAL_STARTED').catch(err => {
    console.warn('⚠️ [CRM Webhook] Trial start sync error:', err.message);
  });

  return {
    success: true,
    trialStart: trialStartStr,
    trialEnd: trialEndStr
  };
}

function getCancelStatusBySubscriptionStatus(status) {
  if (status === 'Scheduled to cancel') return 'scheduled';
  if (status === 'cancelled') return 'cancelled';
  return 'active';
}

async function getUserLoginByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const [rows] = await db.query(
    `SELECT id, username, email
     FROM \`reviewfic-userlogin\`
     WHERE email = ?
     LIMIT 1`,
    [normalizedEmail]
  );

  return rows[0] || null;
}

async function syncUserLoginSubscriptionState({
  userLoginId = null,
  email = null,
  plan = null,
  status = null,
}) {
  let resolvedUserId = userLoginId;

  if (!resolvedUserId) {
    const user = await getUserLoginByEmail(email);
    resolvedUserId = user?.id || null;
  }

  if (!resolvedUserId) return;

  const cancelStatus = getCancelStatusBySubscriptionStatus(status);
  const paymentStatus = status || null;

  await db.query(
    `UPDATE \`reviewfic-userlogin\`
     SET
       plan = COALESCE(?, plan),
       subscription_status = COALESCE(?, subscription_status),
       cancel_status = ?,
       payment_status = COALESCE(?, payment_status)
     WHERE id = ?`,
    [plan, status, cancelStatus, paymentStatus, resolvedUserId]
  );

  // Sync updated subscription status to both FluentCRM and CRMfic
  syncUserToAllCRMs(resolvedUserId || email, 'SUBSCRIPTION_UPDATED').catch(err => {
    console.warn('⚠️ [CRM Webhook] Subscription sync error:', err.message);
  });
}

async function syncUserLoginStateFromSubscriptionId(subscriptionId) {
  if (!subscriptionId) return;

  const [rows] = await db.query(
    `SELECT user_login_id, email, plan, status
     FROM payments
     WHERE stripe_subscription_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [subscriptionId]
  );

  if (rows.length === 0) return;

  const latest = rows[0];
  await syncUserLoginSubscriptionState({
    userLoginId: latest.user_login_id,
    email: latest.email,
    plan: latest.plan,
    status: latest.status,
  });
}

async function getInvoiceClientSecret(invoiceId, maxAttempts = 3, delayMs = 250) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const latestInvoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['payment_intent', 'confirmation_secret'],
    });

    const clientSecret =
      latestInvoice.payment_intent?.client_secret ||
      latestInvoice.confirmation_secret?.client_secret;

    if (clientSecret) {
      return clientSecret;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────
//  Frontend payment tracking stubs (non-blocking, no-op)
//  The frontend calls these after payment to optionally track;
//  real subscription state is managed by /api/verify-payment.
// ────────────────────────────────────────────────────────────
app.post(
  ['/api/webhook/payment', '/webhook/payment', '/api/webhook/payment-completed', '/webhook/payment-completed'],
  express.json(),
  (req, res) => {
    // Non-blocking acknowledgement — actual payment recording happens via /api/verify-payment
    res.json({ received: true });
  }
);

// ────────────────────────────────────────────────────────────
//  Stripe Webhook  (raw body required for signature check)
// ────────────────────────────────────────────────────────────
function extractEventPriceIds(event) {
  const obj = event.data?.object;
  if (!obj) return [];
  const priceIds = new Set();

  const addPrice = (p) => {
    if (!p) return;
    if (typeof p === 'string') {
      priceIds.add(p);
    } else if (typeof p === 'object') {
      if (p.id) priceIds.add(p.id);
      if (p.price) {
        if (typeof p.price === 'string') priceIds.add(p.price);
        else if (p.price.id) priceIds.add(p.price.id);
      }
    }
  };

  // 1. Subscription items (customer.subscription.*)
  if (Array.isArray(obj.items?.data)) {
    for (const item of obj.items.data) {
      addPrice(item.price);
      addPrice(item.plan);
      addPrice(item.pricing?.price_details?.price);
    }
  }

  // 2. Invoice lines (invoice.*)
  if (Array.isArray(obj.lines?.data)) {
    for (const line of obj.lines.data) {
      addPrice(line.price);
      addPrice(line.plan);
      addPrice(line.pricing?.price_details?.price);
    }
  }

  // 3. Line items (checkout.session.* or invoice)
  if (Array.isArray(obj.line_items?.data)) {
    for (const item of obj.line_items.data) {
      addPrice(item.price);
      addPrice(item.plan);
      addPrice(item.pricing?.price_details?.price);
    }
  }

  // 4. Metadata price_id
  if (obj.metadata?.price_id) {
    addPrice(obj.metadata.price_id);
  }

  // 5. Parent subscription_details metadata
  if (obj.parent?.subscription_details?.metadata?.price_id) {
    addPrice(obj.parent.subscription_details.metadata.price_id);
  }

  return Array.from(priceIds).filter(Boolean);
}

function getSubscriptionIdFromObject(obj) {
  if (!obj) return null;
  if (obj.object === 'subscription') return obj.id || null;
  if (typeof obj.subscription === 'string') return obj.subscription;
  if (obj.subscription?.id) return obj.subscription.id;
  if (obj.parent?.subscription_details?.subscription) {
    const s = obj.parent.subscription_details.subscription;
    return typeof s === 'string' ? s : s.id || null;
  }
  const lineSub = obj.lines?.data?.[0]?.parent?.subscription_item_details?.subscription;
  if (lineSub) {
    return typeof lineSub === 'string' ? lineSub : lineSub.id || null;
  }
  return null;
}

async function isEventForCurrentApp(event) {
  const obj = event.data?.object;
  if (!obj) return { match: false, reason: 'missing_object' };

  const priceMap = getPriceMap();
  const allowedPriceIds = Object.values(priceMap).filter(Boolean);

  // 1. Direct price IDs extracted from the event payload
  const foundPriceIds = extractEventPriceIds(event);
  if (foundPriceIds.length > 0) {
    const hasMatch = foundPriceIds.some(id => allowedPriceIds.includes(id));
    if (hasMatch) {
      return { match: true, reason: 'price_matched', priceId: foundPriceIds.find(id => allowedPriceIds.includes(id)) };
    }
    // Prices were present in the event and NONE match Reviewfic: this is definitely another app (e.g. Tourfic, Connectfic, BEAF)
    return { match: false, reason: 'price_mismatch', foundPrices: foundPriceIds };
  }

  // 2. Metadata check
  const meta = obj.metadata || obj.parent?.subscription_details?.metadata;
  if (meta) {
    if (meta.framer_site_id || meta.app === 'reviewfic' || meta.plugin === 'reviewfic') {
      return { match: true, reason: 'metadata_matched' };
    }
    // Foreign application markers
    if (meta.fct_ref_id || meta.order_reference || Object.keys(meta).some(k => k.startsWith('product_'))) {
      return { match: false, reason: 'foreign_metadata_mismatch' };
    }
  }

  // 3. Subscription lookup
  const subscriptionId = getSubscriptionIdFromObject(obj);
  if (subscriptionId) {
    try {
      // Check database first
      const [rows] = await db.query(
        'SELECT id FROM payments WHERE stripe_subscription_id = ? LIMIT 1',
        [subscriptionId]
      );
      if (rows && rows.length > 0) {
        return { match: true, reason: 'db_subscription_matched' };
      }
      // If not in DB, retrieve subscription from Stripe
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const subPrices = (sub.items?.data || []).map(i => i.price?.id || i.plan?.id || i.pricing?.price_details?.price).filter(Boolean);
      const subMatch = subPrices.some(p => allowedPriceIds.includes(p)) ||
        sub.metadata?.framer_site_id ||
        sub.metadata?.app === 'reviewfic' ||
        sub.metadata?.plugin === 'reviewfic';
      if (subMatch) {
        return { match: true, reason: 'stripe_subscription_matched' };
      }
      return { match: false, reason: 'subscription_belongs_to_other_app', subscriptionId };
    } catch (err) {
      console.warn('⚠️ Could not verify subscription for webhook event filtering:', err.message);
    }
  }

  // 4. Payment intent lookup
  if (obj.object === 'payment_intent') {
    if (obj.description && obj.description.toLowerCase().includes('reviewfic')) {
      return { match: true, reason: 'description_matched' };
    }
    try {
      const [rows] = await db.query(
        'SELECT id FROM payments WHERE payment_intent_id = ? LIMIT 1',
        [obj.id]
      );
      if (rows && rows.length > 0) {
        return { match: true, reason: 'db_payment_intent_matched' };
      }
    } catch (err) {
      console.warn('⚠️ Could not verify payment_intent in DB:', err.message);
    }
    return { match: false, reason: 'unrecognized_payment_intent' };
  }

  // 5. Default fallback: No Reviewfic identifiers found
  return { match: false, reason: 'no_reviewfic_identifiers' };
}

app.post(['/api/webhook', '/api/stripe/webhook'], express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // ── Filter events belonging to other applications ──
  const appCheck = await isEventForCurrentApp(event);
  if (!appCheck.match) {
    const details = appCheck.foundPrices && appCheck.foundPrices.length > 0
      ? `price ID(s): ${appCheck.foundPrices.join(', ')}`
      : `reason: ${appCheck.reason}`;
    console.log(`⏭️ Ignoring Stripe event ${event.type} (${event.id}) because it belongs to another application (${details}).`);
    return res.json({ received: true });
  }

  // ── Idempotency: skip already-processed events ──
  try {
    const [existing] = await db.query(
      'SELECT id FROM webhook_events WHERE stripe_event_id = ?',
      [event.id]
    );
    if (existing.length > 0) {
      console.log(`⏭️  Event ${event.id} already processed, skipping.`);
      return res.json({ received: true });
    }

    // Store event for audit trail
    await db.query(
      'INSERT INTO webhook_events (stripe_event_id, event_type, payload) VALUES (?, ?, ?)',
      [event.id, event.type, JSON.stringify(event.data.object)]
    );
  } catch (dbErr) {
    console.error('⚠️ Error checking/storing webhook event:', dbErr.message);
  }

  // ── Route events ──
  const allowedPriceIds = Object.values(getPriceMap()).filter(Boolean);
  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const siteId = paymentIntent.metadata?.framer_site_id || null;
        const plan = paymentIntent.metadata?.plan_type || null;
        const email = normalizeEmail(paymentIntent.receipt_email || paymentIntent.metadata?.framer_user_email);
        const framerUserId = paymentIntent.metadata?.framer_user_id || null;
        const customerId = typeof paymentIntent.customer === 'string' ? paymentIntent.customer : null;
        const userLogin = await getUserLoginByEmail(email);
        const userLoginId = userLogin?.id || null;
        const username = userLogin?.username || paymentIntent.metadata?.framer_user_name || null;

        if (!siteId || plan !== 'lifetime') break;

        const expiresAt = getExpiryDate(plan);

        await db.query(
          `INSERT INTO payments (
            user_login_id,
            username,
            site_id,
            framer_user_id,
            plan,
            email,
            stripe_customer_id,
            payment_intent_id,
            amount,
            currency,
            status,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            user_login_id = COALESCE(VALUES(user_login_id), user_login_id),
            username = COALESCE(VALUES(username), username),
            framer_user_id = COALESCE(VALUES(framer_user_id), framer_user_id),
            plan = VALUES(plan),
            email = COALESCE(VALUES(email), email),
            stripe_customer_id = COALESCE(VALUES(stripe_customer_id), stripe_customer_id),
            amount = VALUES(amount),
            currency = VALUES(currency),
            status = VALUES(status),
            expires_at = VALUES(expires_at)`,
          [
            userLoginId,
            username,
            siteId,
            framerUserId,
            plan,
            email,
            customerId,
            paymentIntent.id,
            toMajorUnits(paymentIntent.amount),
            paymentIntent.currency,
            'paid',
            expiresAt
          ]
        );

        await syncUserLoginSubscriptionState({
          userLoginId,
          email,
          plan,
          status: 'paid',
        });

        sendTeamPurchaseNotification({
          username: username || email?.split('@')[0],
          email: email,
          plan: plan,
          amount: toMajorUnits(paymentIntent.amount),
          currency: paymentIntent.currency,
          siteId: siteId,
          paymentId: paymentIntent.id,
          couponCode: paymentIntent.metadata?.coupon_code || paymentIntent.metadata?.coupon || null,
        }).catch(err => console.error('⚠️ Team purchase notification error:', err.message));
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const siteId =
          subscription.metadata?.framer_site_id ||
          subscription.items?.data?.[0]?.price?.metadata?.framer_site_id ||
          null;
        const plan = subscription.metadata?.plan_type || null;
        const customerId = subscription.customer || null;
        const subscriptionId = subscription.id;
        const status = subscription.cancel_at_period_end ? 'Scheduled to cancel' : subscription.status;
        const customerEmail = normalizeEmail(await getCustomerEmail(customerId));
        const userLogin = await getUserLoginByEmail(customerEmail);
        const userLoginId = userLogin?.id || null;
        const username = userLogin?.username || subscription.metadata?.framer_user_name || null;
        const expiresAt =
          unixToMySQLDateTime(subscription.current_period_end) ||
          unixToMySQLDateTime(subscription.items?.data?.[0]?.current_period_end);

        if (!siteId) {
          console.warn('Subscription event missing siteId');
          break;
        }

        const [existingRows] = await db.query(
          `SELECT id FROM payments WHERE stripe_subscription_id = ? LIMIT 1`,
          [subscriptionId]
        );

        let webhookCouponCode = null;
        if (subscription.discount?.promotion_code) {
          try {
            const promoObj = await stripe.promotionCodes.retrieve(subscription.discount.promotion_code);
            webhookCouponCode = promoObj.code;
          } catch (e) {
            console.warn('⚠️ Failed to retrieve promotion code for webhook:', e.message);
          }
        } else if (subscription.discount?.coupon?.id) {
          webhookCouponCode = subscription.discount.coupon.id;
        }

        if (existingRows.length > 0) {
          await db.query(
            `UPDATE payments
             SET status = ?, expires_at = ?, stripe_customer_id = ?, plan = COALESCE(?, plan), email = COALESCE(?, email), user_login_id = COALESCE(?, user_login_id), username = COALESCE(?, username), coupon_code = COALESCE(?, coupon_code)
             WHERE stripe_subscription_id = ?`,
            [status, expiresAt, customerId, plan, customerEmail, userLoginId, username, webhookCouponCode, subscriptionId]
          );
        } else {
          await db.query(
            `INSERT INTO payments (
              user_login_id,
              username,
              site_id,
              plan,
              email,
              stripe_customer_id,
              stripe_subscription_id,
              amount,
              currency,
              status,
              expires_at,
              coupon_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userLoginId,
              username,
              siteId,
              plan,
              customerEmail,
              customerId,
              subscriptionId,
              null,
              subscription.currency || 'usd',
              status,
              expiresAt,
              webhookCouponCode
            ]
          );
        }

        await syncUserLoginSubscriptionState({
          userLoginId,
          email: customerEmail,
          plan,
          status,
        });

        if (subscription.cancel_at_period_end) {
          try {
            const [payFeedbackRows] = await db.query(
              `SELECT user_feedback FROM payments WHERE stripe_subscription_id = ? LIMIT 1`,
              [subscriptionId]
            );
            const feedbackVal = payFeedbackRows?.[0]?.user_feedback || null;
            sendTeamCancellationNotification({
              username: username || customerEmail?.split('@')[0] || 'Customer',
              email: customerEmail,
              plan: plan || 'subscription',
              siteId: siteId || 'N/A',
              subscriptionId: subscriptionId,
              status: 'Scheduled to cancel at end of billing cycle',
              effectiveDate: expiresAt,
              feedback: feedbackVal,
            }).catch(err => console.error('⚠️ Team cancellation notification error (updated event):', err.message));

            // Sync cancellation to CRMfic and FluentCRM
            if (customerEmail) {
              forwardToCRMfic({
                email: customerEmail,
                username: username || customerEmail.split('@')[0],
                status: 'Subscribed',
                list: ['App Users', 'Reviewfic'],
                tags: ['Reviewfic-Cancelled', 'Reviewfic'],
                plan: plan || 'subscription',
                paymentStatus: 'cancelled',
                subscriptionId,
                effectiveDate: expiresAt,
                cancellationReason: feedbackVal,
                event: 'plan_canceled',
              }).catch(err => console.warn('⚠️ CRMfic plan canceled sync error (updated event):', err.message));

              forwardToFluentCRM({
                email: customerEmail,
                username: username || customerEmail.split('@')[0],
                status: 'subscribed',
                list: ['App Users', 'Reviewfic'],
                tags: ['Reviewfic-Cancelled', 'Reviewfic'],
                plan: plan || 'subscription',
                paymentStatus: 'cancelled',
                subscriptionId,
                effectiveDate: expiresAt,
                cancellationReason: feedbackVal,
                event: 'plan_canceled',
              }).catch(err => console.warn('⚠️ FluentCRM plan canceled sync error (updated event):', err.message));
            }
          } catch (updErr) {
            console.warn('⚠️ Error sending team cancellation notification on updated event:', updErr.message);
          }
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object;
        const siteId = subscription.metadata?.framer_site_id || null;
        const subPrices = extractEventPriceIds(event);
        const hasReviewficPrice = subPrices.some(p => allowedPriceIds.includes(p));
        if (!siteId && !hasReviewficPrice) {
          console.log(`⏭️ Skipping customer.subscription.trial_will_end: Not a Reviewfic subscription (${subscription.id}).`);
          break;
        }
        const customerEmail = normalizeEmail(await getCustomerEmail(subscription.customer));
        const plan = subscription.metadata?.plan_type || 'subscription';
        if (customerEmail) {
          forwardToCRMfic({
            email: customerEmail,
            status: 'Subscribed',
            list: ['App Users', 'Reviewfic'],
            tags: ['Reviewfic-Expiring-Soon', 'Reviewfic-Trial', 'Reviewfic'],
            plan,
            paymentStatus: 'trialing',
            event: 'trial_will_end',
          }).catch(err => console.warn('⚠️ CRMfic trial will end sync error:', err.message));
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        await db.query(
          `UPDATE payments
           SET status = ?, expires_at = ?
           WHERE stripe_subscription_id = ?`,
          ['cancelled', null, subscriptionId]
        );

        await syncUserLoginStateFromSubscriptionId(subscriptionId);

        try {
          const [payRows] = await db.query(
            `SELECT user_login_id, username, email, plan, site_id, user_feedback FROM payments WHERE stripe_subscription_id = ? ORDER BY id DESC LIMIT 1`,
            [subscriptionId]
          );
          const payRec = payRows && payRows[0] ? payRows[0] : null;
          const siteId = payRec?.site_id || subscription.metadata?.framer_site_id || null;
          const subPrices = extractEventPriceIds(event);
          const hasReviewficPrice = subPrices.some(p => allowedPriceIds.includes(p));

          if (!siteId && !hasReviewficPrice && !payRec) {
            console.log(`⏭️ Skipping customer.subscription.deleted notifications: Subscription ${subscriptionId} does not belong to Reviewfic.`);
            break;
          }

          const customerEmail = payRec?.email || normalizeEmail(await getCustomerEmail(subscription.customer));
          const username = payRec?.username || (customerEmail ? customerEmail.split('@')[0] : 'Customer');
          const resolvedSiteId = siteId || 'N/A';
          const plan = payRec?.plan || subscription.metadata?.plan_type || 'subscription';
          const feedback = payRec?.user_feedback || null;

          const isIncomplete = subscription.status === 'incomplete_expired' || subscription.status === 'incomplete';
          if (isIncomplete) {
            sendTeamPaymentFailedNotification({
              username,
              email: customerEmail,
              plan,
              amount: 0,
              currency: subscription.currency || 'USD',
              siteId,
              subscriptionId,
              paymentId: subscription.latest_invoice || subscriptionId,
              failureReason: 'Customer started checkout but payment was incomplete or expired without completion.',
              status: 'Incomplete / Abandoned',
              isIncomplete: true,
            }).catch(err => console.error('⚠️ Team incomplete payment notification error (deleted event):', err.message));

            if (customerEmail) {
              forwardToCRMfic({
                email: customerEmail,
                username,
                status: 'Subscribed',
                list: ['App Users', 'Reviewfic'],
                tags: ['Reviewfic-Failed', 'Reviewfic'],
                plan,
                paymentStatus: 'failed',
                subscriptionId,
                failureReason: 'Incomplete / Abandoned Checkout',
                event: 'payment_failed',
              }).catch(err => console.warn('⚠️ CRMfic incomplete payment sync error:', err.message));
            }
          } else {
            sendTeamCancellationNotification({
              username,
              email: customerEmail,
              plan,
              siteId,
              subscriptionId,
              status: 'Subscription Ended / Cancelled',
              effectiveDate: 'Immediately (Subscription Ended)',
              feedback,
            }).catch(err => console.error('⚠️ Team cancellation notification error (deleted event):', err.message));

            if (customerEmail) {
              forwardToCRMfic({
                email: customerEmail,
                username,
                status: 'Subscribed',
                list: ['App Users', 'Reviewfic'],
                tags: ['Reviewfic-Cancelled', 'Reviewfic'],
                plan,
                paymentStatus: 'cancelled',
                subscriptionId,
                effectiveDate: 'Immediately',
                cancellationReason: feedback,
                event: 'plan_canceled',
              }).catch(err => console.warn('⚠️ CRMfic plan canceled sync error (deleted event):', err.message));

              forwardToFluentCRM({
                email: customerEmail,
                username,
                status: 'subscribed',
                list: ['App Users', 'Reviewfic'],
                tags: ['Reviewfic-Cancelled', 'Reviewfic'],
                plan,
                paymentStatus: 'cancelled',
                subscriptionId,
                effectiveDate: 'Immediately',
                cancellationReason: feedback,
                event: 'plan_canceled',
              }).catch(err => console.warn('⚠️ FluentCRM plan canceled sync error (deleted event):', err.message));
            }
          }
        } catch (delErr) {
          console.warn('⚠️ Error preparing team notification on deleted event:', delErr.message);
        }
        break;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = getSubscriptionIdFromObject(invoice);
        const customerId = invoice.customer || null;
        const customerEmail = normalizeEmail(invoice.customer_email || await getCustomerEmail(customerId));
        const userLogin = await getUserLoginByEmail(customerEmail);
        const userLoginId = userLogin?.id || null;
        const username = userLogin?.username || null;

        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const siteId = subscription.metadata?.framer_site_id || null;
        const plan = subscription.metadata?.plan_type || null;
        const framerUserId = subscription.metadata?.framer_user_id || null;
        const expiresAt =
          unixToMySQLDateTime(subscription.current_period_end) ||
          unixToMySQLDateTime(subscription.items?.data?.[0]?.current_period_end);
        const resolvedStatus = subscription.cancel_at_period_end ? 'Scheduled to cancel' : subscription.status;

        const [existingRows] = await db.query(
          `SELECT id, plan, site_id FROM payments WHERE stripe_subscription_id = ? LIMIT 1`,
          [subscriptionId]
        );

        if (existingRows.length === 0 && !siteId) {
          console.log(`⏭️ Skipping invoice.paid: Subscription ${subscriptionId} has no Reviewfic siteId or payment record.`);
          break;
        }

        if (existingRows.length > 0) {
          await db.query(
            `UPDATE payments
             SET status = ?, expires_at = ?, stripe_customer_id = ?, plan = COALESCE(?, plan), email = COALESCE(?, email), amount = ?, currency = ?, user_login_id = COALESCE(?, user_login_id), username = COALESCE(?, username), framer_user_id = COALESCE(?, framer_user_id)
             WHERE stripe_subscription_id = ?`,
            [
              resolvedStatus,
              expiresAt,
              customerId,
              plan,
              customerEmail,
              toMajorUnits(invoice.amount_paid),
              invoice.currency || 'usd',
              userLoginId,
              username,
              framerUserId,
              subscriptionId
            ]
          );
        } else if (siteId) {
          await db.query(
            `INSERT INTO payments (
              user_login_id,
              username,
              site_id,
              framer_user_id,
              plan,
              email,
              stripe_customer_id,
              stripe_subscription_id,
              amount,
              currency,
              status,
              expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userLoginId,
              username,
              siteId,
              framerUserId,
              plan,
              customerEmail,
              customerId,
              subscriptionId,
              toMajorUnits(invoice.amount_paid),
              invoice.currency || 'usd',
              resolvedStatus,
              expiresAt
            ]
          );
        }

        await syncUserLoginSubscriptionState({
          userLoginId,
          email: customerEmail,
          plan,
          status: subscription.status,
        });

        const isRecurringPayment =
          invoice.billing_reason === 'subscription_cycle' ||
          (existingRows.length > 0 && invoice.billing_reason !== 'subscription_create');

        const cleanPlanName = (plan || existingRows[0]?.plan || '').replace(/^plan[-_]?/i, '').replace(/^reviewfic[-_]?/i, '');
        const formattedPlanTag = cleanPlanName ? cleanPlanName.charAt(0).toUpperCase() + cleanPlanName.slice(1) : null;

        if (isRecurringPayment) {
          sendTeamRecurringPaymentNotification({
            username: username || customerEmail?.split('@')[0],
            email: customerEmail,
            plan: plan || existingRows[0]?.plan || 'subscription',
            amount: toMajorUnits(invoice.amount_paid),
            currency: invoice.currency,
            siteId: siteId || existingRows[0]?.site_id || 'N/A',
            paymentId: invoice.id,
            subscriptionId: subscriptionId,
            nextBillingDate: expiresAt,
            billingReason: invoice.billing_reason === 'subscription_cycle' ? 'Subscription Cycle Renewal' : (invoice.billing_reason || 'Recurring Payment'),
          }).catch(err => console.error('⚠️ Team recurring payment notification error:', err.message));

          // Dispatch short & meaningful tags to CRMfic and FluentCRM on recurring payment success
          const recurringTags = ['Reviewfic-Renewed', 'Reviewfic-Paid', formattedPlanTag ? `Reviewfic-${formattedPlanTag}` : null, 'Reviewfic'].filter(Boolean);
          forwardToCRMfic({
            email: customerEmail,
            username: username || customerEmail?.split('@')[0],
            status: 'Subscribed',
            list: ['App Users', 'Reviewfic'],
            tags: recurringTags,
            plan: plan || existingRows[0]?.plan || 'monthly',
            paymentStatus: 'paid',
            siteName: siteId || null,
            event: 'recurring_payment',
            amount: toMajorUnits(invoice.amount_paid),
            currency: invoice.currency,
            paymentId: invoice.id,
            subscriptionId: subscriptionId,
            billingReason: invoice.billing_reason === 'subscription_cycle' ? 'Subscription Cycle Renewal' : (invoice.billing_reason || 'Recurring Payment'),
          }).catch(err => console.warn('⚠️ CRMfic recurring payment sync error:', err.message));

          forwardToFluentCRM({
            email: customerEmail,
            username: username || customerEmail?.split('@')[0],
            status: 'subscribed',
            list: ['App Users', 'Reviewfic'],
            tags: recurringTags,
            plan: plan || existingRows[0]?.plan || 'monthly',
            paymentStatus: 'paid',
            siteName: siteId || null,
            event: 'recurring_payment',
            amount: toMajorUnits(invoice.amount_paid),
            currency: invoice.currency,
            paymentId: invoice.id,
            subscriptionId: subscriptionId,
            billingReason: invoice.billing_reason === 'subscription_cycle' ? 'Subscription Cycle Renewal' : (invoice.billing_reason || 'Recurring Payment'),
          }).catch(err => console.warn('⚠️ FluentCRM recurring payment sync error:', err.message));
        } else {
          let invoiceCouponCode = null;
          if (subscription.discount?.promotion_code) {
            try {
              const promoObj = await stripe.promotionCodes.retrieve(subscription.discount.promotion_code);
              invoiceCouponCode = promoObj.code;
            } catch (e) { }
          } else if (subscription.discount?.coupon?.id) {
            invoiceCouponCode = subscription.discount.coupon.id;
          }

          sendTeamPurchaseNotification({
            username: username || customerEmail?.split('@')[0],
            email: customerEmail,
            plan: plan || 'subscription',
            amount: toMajorUnits(invoice.amount_paid),
            currency: invoice.currency,
            siteId: siteId || 'N/A',
            paymentId: invoice.payment_intent || invoice.id || subscriptionId,
            couponCode: invoiceCouponCode,
          }).catch(err => console.error('⚠️ Team purchase notification error:', err.message));

          // Dispatch to CRMfic and FluentCRM on initial purchase
          const purchaseTags = ['Reviewfic-Paid', formattedPlanTag ? `Reviewfic-${formattedPlanTag}` : null, 'Reviewfic'].filter(Boolean);
          forwardToCRMfic({
            email: customerEmail,
            username: username || customerEmail?.split('@')[0],
            status: 'Subscribed',
            list: ['App Users', 'Reviewfic'],
            tags: purchaseTags,
            plan: plan || 'subscription',
            paymentStatus: 'paid',
            siteName: siteId || null,
            event: 'purchase_success',
            amount: toMajorUnits(invoice.amount_paid),
            currency: invoice.currency,
            paymentId: invoice.payment_intent || invoice.id || subscriptionId,
          }).catch(err => console.warn('⚠️ CRMfic purchase sync error:', err.message));

          forwardToFluentCRM({
            email: customerEmail,
            username: username || customerEmail?.split('@')[0],
            status: 'subscribed',
            list: ['App Users', 'Reviewfic'],
            tags: purchaseTags,
            plan: plan || 'subscription',
            paymentStatus: 'paid',
            siteName: siteId || null,
            event: 'purchase_success',
            amount: toMajorUnits(invoice.amount_paid),
            currency: invoice.currency,
            paymentId: invoice.payment_intent || invoice.id || subscriptionId,
          }).catch(err => console.warn('⚠️ FluentCRM purchase sync error:', err.message));
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = getSubscriptionIdFromObject(invoice);
        const customerId = invoice.customer || null;
        const customerEmail = normalizeEmail(invoice.customer_email || await getCustomerEmail(customerId));
        const userLogin = await getUserLoginByEmail(customerEmail);
        const userLoginId = userLogin?.id || null;
        const username = userLogin?.username || null;

        if (subscriptionId) {
          await db.query(
            `UPDATE payments
             SET status = ?
             WHERE stripe_subscription_id = ?`,
            ['past_due', subscriptionId]
          );

          await syncUserLoginStateFromSubscriptionId(subscriptionId);
        }

        try {
          let plan = null;
          let siteId = null;

          if (subscriptionId) {
            try {
              const subscription = await stripe.subscriptions.retrieve(subscriptionId);
              siteId = subscription.metadata?.framer_site_id || null;
              plan = subscription.metadata?.plan_type || null;
            } catch (subErr) {
              console.warn('⚠️ Could not retrieve subscription for failed invoice:', subErr.message);
            }
          }

          let payRows = [];
          if (!plan || !siteId) {
            const [rows] = await db.query(
              `SELECT plan, site_id FROM payments WHERE stripe_subscription_id = ? ORDER BY id DESC LIMIT 1`,
              [subscriptionId || '']
            );
            payRows = rows;
            if (payRows && payRows[0]) {
              plan = plan || payRows[0].plan;
              siteId = siteId || payRows[0].site_id;
            }
          }

          // Strict guard: If invoice has no siteId and no matching payment in database, it does NOT belong to Reviewfic!
          if (!siteId && (!subscriptionId || !payRows || payRows.length === 0)) {
            console.log(`⏭️ Skipping invoice.payment_failed: Invoice ${invoice.id} has no Reviewfic siteId or payment record.`);
            break;
          }

          const rawReason =
            invoice.last_payment_error?.message ||
            invoice.charge?.failure_message ||
            (invoice.next_payment_attempt
              ? `Charge failed. Stripe will retry on ${new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()}.`
              : 'Payment transaction failed or card declined.');

          const attemptCount = invoice.attempt_count ? `Attempt #${invoice.attempt_count}` : 'Failed Attempt';

          sendTeamPaymentFailedNotification({
            username: username || customerEmail?.split('@')[0] || 'Customer',
            email: customerEmail,
            plan: plan || 'subscription',
            amount: toMajorUnits(invoice.amount_due || invoice.amount_remaining || 0),
            currency: invoice.currency || 'usd',
            siteId: siteId || 'N/A',
            paymentId: invoice.id,
            subscriptionId: subscriptionId || 'N/A',
            failureReason: rawReason,
            status: `Past Due (${attemptCount})`,
            isIncomplete: false,
          }).catch(err => console.error('⚠️ Team payment failed notification error:', err.message));

          // Dispatch short & meaningful tag 'Reviewfic-Failed' to CRMfic and FluentCRM
          if (customerEmail) {
            forwardToCRMfic({
              email: customerEmail,
              username: username || customerEmail?.split('@')[0] || 'Customer',
              status: 'Subscribed',
              list: ['App Users', 'Reviewfic'],
              tags: ['Reviewfic-Failed', 'Reviewfic'],
              plan: plan || 'subscription',
              paymentStatus: 'failed',
              event: 'payment_failed',
              amount: toMajorUnits(invoice.amount_due || invoice.amount_remaining || 0),
              currency: invoice.currency || 'usd',
              paymentId: invoice.id,
              subscriptionId: subscriptionId || 'N/A',
              failureReason: rawReason,
            }).catch(err => console.warn('⚠️ CRMfic payment failed sync error:', err.message));

            forwardToFluentCRM({
              email: customerEmail,
              username: username || customerEmail?.split('@')[0] || 'Customer',
              status: 'subscribed',
              list: ['App Users', 'Reviewfic'],
              tags: ['Reviewfic-Failed', 'Reviewfic'],
              plan: plan || 'subscription',
              paymentStatus: 'failed',
              event: 'payment_failed',
              amount: toMajorUnits(invoice.amount_due || invoice.amount_remaining || 0),
              currency: invoice.currency || 'usd',
              paymentId: invoice.id,
              subscriptionId: subscriptionId || 'N/A',
              failureReason: rawReason,
            }).catch(err => console.warn('⚠️ FluentCRM payment failed sync error:', err.message));
          }
        } catch (failErr) {
          console.error('⚠️ Error processing payment failed notification:', failErr.message);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const siteId = paymentIntent.metadata?.framer_site_id || null;
        const priceId = paymentIntent.metadata?.price_id || null;
        const isReviewficDesc = paymentIntent.description && (paymentIntent.description.toLowerCase().includes('reviewfic') || description.toLowerCase().includes('chat bubbles') || paymentIntent.description.toLowerCase().includes('reviewfic') || description.toLowerCase().includes('chat bubbles'));

        // Verify if payment intent belongs to Reviewfic
        if (!siteId && !isReviewficDesc && (!priceId || !allowedPriceIds.includes(priceId))) {
          console.log(`⏭️ Skipping payment_intent.payment_failed: Payment intent ${paymentIntent.id} does not belong to Reviewfic.`);
          break;
        }

        const email = normalizeEmail(paymentIntent.receipt_email || paymentIntent.metadata?.framer_user_email);
        const userLogin = await getUserLoginByEmail(email);
        const username = userLogin?.username || paymentIntent.metadata?.framer_user_name || (email ? email.split('@')[0] : 'Customer');
        const plan = paymentIntent.metadata?.plan_type || 'one-time';
        const resolvedSiteId = siteId || 'N/A';
        const reason = paymentIntent.last_payment_error?.message || 'Payment card declined or 3D Secure authentication failed.';

        sendTeamPaymentFailedNotification({
          username,
          email,
          plan,
          amount: toMajorUnits(paymentIntent.amount || 0),
          currency: paymentIntent.currency || 'usd',
          siteId: resolvedSiteId,
          paymentId: paymentIntent.id,
          subscriptionId: 'N/A',
          failureReason: reason,
          status: 'Payment Failed',
          isIncomplete: false,
        }).catch(err => console.error('⚠️ Team payment intent failed notification error:', err.message));

        if (email) {
          forwardToCRMfic({
            email,
            username,
            status: 'Subscribed',
            list: ['App Users', 'Reviewfic'],
            tags: ['Reviewfic-Failed', 'Reviewfic'],
            plan,
            paymentStatus: 'failed',
            event: 'payment_failed',
            amount: toMajorUnits(paymentIntent.amount || 0),
            currency: paymentIntent.currency || 'usd',
            paymentId: paymentIntent.id,
            failureReason: reason,
          }).catch(err => console.warn('⚠️ CRMfic payment intent failed sync error:', err.message));

          forwardToFluentCRM({
            email,
            username,
            status: 'subscribed',
            list: ['App Users', 'Reviewfic'],
            tags: ['Reviewfic-Failed', 'Reviewfic'],
            plan,
            paymentStatus: 'failed',
            event: 'payment_failed',
            amount: toMajorUnits(paymentIntent.amount || 0),
            currency: paymentIntent.currency || 'usd',
            paymentId: paymentIntent.id,
            failureReason: reason,
          }).catch(err => console.warn('⚠️ FluentCRM payment intent failed sync error:', err.message));
        }
        break;
      }

      default:
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
    }

    // Mark as processed
    try {
      await db.query(
        'UPDATE webhook_events SET processed = TRUE WHERE stripe_event_id = ?',
        [event.id]
      );
    } catch (updateErr) {
      console.error('⚠️ Error marking webhook event as processed:', updateErr.message);
    }
  } catch (handlerErr) {
    console.error(`❌ Error handling event ${event.type}:`, handlerErr);
  }

  res.json({ received: true });
});

// ────────────────────────────────────────────────────────────
//  CRM Webhook Engine (FluentCRM & CRMfic)
//  Unified logic maintained in ./webhookcrm.js
// ────────────────────────────────────────────────────────────



/**
 * Helper to find or create a Stripe Customer for a given site/user.
 */
async function findOrCreateStripeCustomer(siteId, email, userName = null, framerUserId = null) {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set valid Stripe sandbox API credentials in your .env file.');
  }

  // Check if we already have a customer ID for this site
  const [existing] = await db.query(
    'SELECT stripe_customer_id FROM payments WHERE site_id = ? AND stripe_customer_id IS NOT NULL ORDER BY id DESC LIMIT 1',
    [siteId]
  );

  if (existing.length > 0 && existing[0].stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(existing[0].stripe_customer_id);
      if (customer && !customer.deleted) {
        const needsEmailUpdate = email && customer.email !== email;
        const needsNameUpdate = userName && customer.name !== userName;
        if (needsEmailUpdate || needsNameUpdate) {
          await stripe.customers.update(customer.id, {
            ...(needsEmailUpdate ? { email } : {}),
            ...(needsNameUpdate ? { name: userName } : {}),
          });
        }
        return customer.id;
      }
    } catch (err) {
      console.warn(`Stored Stripe customer ${existing[0].stripe_customer_id} is invalid:`, err.message);
    }
  }

  // Create new customer
  const customerParams = {
    metadata: {
      framer_site_id: siteId,
      framer_user_id: framerUserId || '',
      framer_user_name: userName || '',
    },
  };
  if (email) customerParams.email = email;
  if (userName) customerParams.name = userName;
  if (framerUserId) customerParams.description = `Framer user ${framerUserId}`;

  const customer = await stripe.customers.create(customerParams);
  return customer.id;
}

async function getCustomerEmail(customerId) {
  if (!stripe || !customerId || typeof customerId !== 'string') return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer || customer.deleted) return null;
    return customer.email || null;
  } catch (error) {
    console.warn(`Unable to resolve Stripe customer email for ${customerId}:`, error.message);
    return null;
  }
}

async function getLatestRecurringSubscriptionRecord(siteId, email = null) {
  const queryParams = [siteId];
  const whereClause = `WHERE site_id = ?`;

  // Pre-check: If the absolute latest recurring payment record is cancelled or unpaid, return null immediately.
  try {
    const [latestRows] = await db.query(
      `SELECT status 
       FROM payments 
       WHERE site_id = ? AND plan IN ('monthly', 'yearly')
       ORDER BY id DESC LIMIT 1`,
      [siteId]
    );
    if (latestRows[0] && ['cancelled', 'canceled', 'unpaid'].includes(latestRows[0].status)) {
      return null;
    }
  } catch (err) {
    console.warn('⚠️ Error in pre-check for cancelled status:', err.message);
  }

  // 0️⃣ Direct check: Is there a record in our payments table with status = 'paid' that is active?
  // This supports immediate payment confirmation before webhook completes and without relying on Stripe roundtrips.
  try {
    const [paidRows] = await db.query(
      `SELECT id, user_login_id, username, plan, status, stripe_subscription_id, stripe_customer_id, email, expires_at, created_at
       FROM payments
       ${whereClause}
         AND plan IN ('monthly', 'yearly')
         AND status = 'paid'
       ORDER BY id DESC
       LIMIT 1`,
      queryParams
    );

    if (paidRows[0]) {
      const record = paidRows[0];

      // Auto-repair missing stripe_subscription_id by linking it from sibling rows
      if (!record.stripe_subscription_id) {
        try {
          const [siblingRows] = await db.query(
            `SELECT stripe_subscription_id, stripe_customer_id 
             FROM payments 
             WHERE site_id = ? 
               AND stripe_subscription_id IS NOT NULL 
             ORDER BY id DESC 
             LIMIT 1`,
            [siteId]
          );
          if (siblingRows[0]?.stripe_subscription_id) {
            record.stripe_subscription_id = siblingRows[0].stripe_subscription_id;
            if (!record.stripe_customer_id) {
              record.stripe_customer_id = siblingRows[0].stripe_customer_id;
            }
            await db.query(
              `UPDATE payments 
               SET stripe_subscription_id = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?) 
               WHERE id = ?`,
              [record.stripe_subscription_id, record.stripe_customer_id, record.id]
            );
            console.log(`Auto-linked stripe_subscription_id ${record.stripe_subscription_id} to paid payment row ${record.id}`);
          }
        } catch (siblingErr) {
          console.warn('⚠️ Error back-filling stripe_subscription_id from sibling:', siblingErr.message);
        }
      }

      const expiryDate = record.expires_at ? new Date(record.expires_at) : null;
      if (!expiryDate || expiryDate > new Date()) {
        return record;
      }
    }
  } catch (err) {
    console.warn('⚠️ Error in direct paid status check fallback:', err.message);
  }

  // 1️⃣ First try: record with a stripe_subscription_id (ideal path)
  const [rows] = await db.query(
    `SELECT id, user_login_id, username, plan, status, stripe_subscription_id, stripe_customer_id, email, expires_at, created_at
     FROM payments
     ${whereClause}
       AND stripe_subscription_id IS NOT NULL
       AND plan IN ('monthly', 'yearly')
       AND status IN ('active', 'trialing', 'past_due', 'paid', 'Scheduled to cancel')
     ORDER BY id DESC
     LIMIT 1`,
    queryParams
  );

  if (rows[0]) {
    const record = rows[0];
    // Auto-repair corrupted expires_at caused by previous proration webhook bug
    if (!record.expires_at) {
      try {
        const sub = await stripe.subscriptions.retrieve(record.stripe_subscription_id);
        const expiresAt =
          unixToMySQLDateTime(sub.current_period_end) ||
          unixToMySQLDateTime(sub.items?.data?.[0]?.current_period_end);

        if (expiresAt) {
          await db.query(
            `UPDATE payments SET expires_at = ? WHERE id = ?`,
            [expiresAt, record.id]
          );
          record.expires_at = expiresAt;
          console.log(`Auto-repaired expires_at for payment row ${record.id}`);
        }
      } catch (err) {
        console.warn(`Could not auto-repair expires_at for row ${record.id}:`, err.message);
      }
    }
    return record;
  }

  // 2️⃣ Fallback: record exists but subscription_id not yet populated (webhook delay)
  //    Try to find it via Stripe customer and back-fill the DB.
  const [fallbackRows] = await db.query(
    `SELECT id, user_login_id, username, plan, status, stripe_subscription_id, stripe_customer_id, email, expires_at, created_at
     FROM payments
     ${whereClause}
       AND plan IN ('monthly', 'yearly')
       AND status IN ('active', 'trialing', 'past_due', 'paid', 'Scheduled to cancel')
     ORDER BY id DESC
     LIMIT 1`,
    queryParams
  );

  const record = fallbackRows[0];
  if (!record) return null;

  // If we have a customer ID, look for active subscriptions on Stripe
  const customerId = record.stripe_customer_id;
  if (customerId) {
    try {
      const subsList = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
      const activeSub = (subsList?.data || []).find((s) =>
        ['active', 'trialing', 'past_due'].includes(s.status) &&
        s.metadata?.framer_site_id === siteId
      );
      if (activeSub) {
        // Back-fill the subscription ID and expires_at in the DB for future requests
        const expiresAt =
          unixToMySQLDateTime(activeSub.current_period_end) ||
          unixToMySQLDateTime(activeSub.items?.data?.[0]?.current_period_end);

        await db.query(
          `UPDATE payments SET stripe_subscription_id = ?, expires_at = COALESCE(?, expires_at) WHERE id = ?`,
          [activeSub.id, expiresAt, record.id]
        );
        record.stripe_subscription_id = activeSub.id;
        record.expires_at = expiresAt || record.expires_at;
        return record;
      }
    } catch (err) {
      console.warn('⚠️  Could not look up Stripe subscriptions for customer:', err.message);
    }
  }

  // 3️⃣ Try by email if we have it and no customer ID worked
  if (record.email) {
    try {
      const customers = await stripe.customers.list({ email: record.email, limit: 5 });
      for (const customer of customers.data) {
        const subsList = await stripe.subscriptions.list({ customer: customer.id, limit: 10 });
        const activeSub = (subsList?.data || []).find((s) =>
          ['active', 'trialing', 'past_due'].includes(s.status) &&
          s.metadata?.framer_site_id === siteId
        );
        if (activeSub) {
          await db.query(
            `UPDATE payments SET stripe_subscription_id = ?, stripe_customer_id = ? WHERE id = ?`,
            [activeSub.id, customer.id, record.id]
          );
          record.stripe_subscription_id = activeSub.id;
          record.stripe_customer_id = customer.id;
          return record;
        }
      }
    } catch (err) {
      console.warn('⚠️  Could not look up Stripe customer by email:', err.message);
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────
//  JSON body + CORS  (AFTER webhook route)
// ────────────────────────────────────────────────────────────
app.use(express.json());

const configuredFrontendOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    try {
      return new URL(value).origin;
    } catch {
      return value;
    }
  });

const allowedOriginSuffixes = [
  '.framer.com',
  '.framer.app',
  '.framercanvas.com',
  '.framer.website',
  '.framerusercontent.com',
  '.framefic.com',
  '.framercdn.com',
];

const isAllowedOrigin = (origin) => {
  if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) {
    return true;
  }

  if (configuredFrontendOrigins.includes(origin)) {
    return true;
  }

  try {
    const { hostname } = new URL(origin);
    return allowedOriginSuffixes.some((suffix) => (
      hostname === suffix.slice(1) || hostname.endsWith(suffix)
    ));
  } catch {
    return false;
  }
};

app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin or sandboxed "null" origin.
    // Framer plugin runtimes can surface as null origin in some contexts.
    if (!origin || origin === 'null') return callback(null, true);
    // Allow configured frontend origins and known Framer/Framefic domains
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    console.warn(`⚠️  CORS rejected origin: ${origin}`);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Mount Auth Module Router
setTeamSignupNotifier(sendTeamSignupNotification);
setSignupVerificationNotifier(sendSignupVerificationEmail);
setPasswordResetNotifier(sendPasswordResetEmail);
setTrialStarter(startTrial);
app.use(authRouter);
app.use('/reviewfic', authRouter);

// Serve static assets for both root and /reviewfic prefix
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/reviewfic/assets', express.static(path.join(__dirname, 'assets')));

app.get(['/assets/Framefic.png', '/reviewfic/assets/Framefic.png', '/assets/framefic.png', '/reviewfic/assets/framefic.png'], (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'Framefic.png'));
});
app.get(['/assets/icon.svg', '/reviewfic/assets/icon.svg', '/assets/Favicon.png', '/reviewfic/assets/Favicon.png', '/assets/favicon.png', '/reviewfic/assets/favicon.png'], (req, res) => {
  const iconPath = path.join(__dirname, 'assets', 'icon.svg');
  if (fs.existsSync(iconPath)) {
    return res.type('image/svg+xml').sendFile(iconPath);
  }
  res.sendFile(path.join(__dirname, 'assets', 'Favicon.png'));
});


// ────────────────────────────────────────────────────────────
//  Auth Configuration
// ────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_SALT_ROUNDS = 12;

// ────────────────────────────────────────────────────────────
//  POST /api/user/site-info
//  Update Framer site name and site URL for a user
// ────────────────────────────────────────────────────────────
app.post('/api/user/site-info', async (req, res) => {
  try {
    const { siteName, siteUrl, framerSiteName, framerSiteUrl, email, userId } = req.body;

    const resolvedSiteName = framerSiteName || siteName || null;
    const resolvedSiteUrl = framerSiteUrl || siteUrl || null;
    const targetEmail = normalizeEmail(email);

    if (!resolvedSiteName && !resolvedSiteUrl) {
      return res.json({ success: true, updated: false, message: 'No site details provided.' });
    }

    let updatedCount = 0;

    if (targetEmail) {
      const [resUser] = await db.query(
        `UPDATE \`reviewfic-userlogin\`
         SET framer_site_name = COALESCE(?, framer_site_name),
             framer_site_url = COALESCE(?, framer_site_url)
         WHERE email = ?`,
        [resolvedSiteName, resolvedSiteUrl, targetEmail]
      );
      updatedCount += resUser.affectedRows || 0;

      await db.query(
        `UPDATE payments
         SET site_name = COALESCE(?, site_name),
             site_url = COALESCE(?, site_url)
         WHERE email = ?`,
        [resolvedSiteName, resolvedSiteUrl, targetEmail]
      );

      await db.query(
        `UPDATE reviewfic_trials
         SET site_name = COALESCE(?, site_name),
             site_url = COALESCE(?, site_url)
         WHERE email = ?`,
        [resolvedSiteName, resolvedSiteUrl, targetEmail]
      );
    }

    if (userId) {
      const [resUserById] = await db.query(
        `UPDATE \`reviewfic-userlogin\`
         SET framer_site_name = COALESCE(?, framer_site_name),
             framer_site_url = COALESCE(?, framer_site_url)
         WHERE id = ?`,
        [resolvedSiteName, resolvedSiteUrl, userId]
      );
      updatedCount += resUserById.affectedRows || 0;
    }

    if (targetEmail || userId) {
      try {
        const [u] = await db.query(
          'SELECT id, username, email FROM `reviewfic-userlogin` WHERE email = ? OR id = ? LIMIT 1',
          [targetEmail || '', userId || 0]
        );
        if (u && u[0]) {
          syncUserToAllCRMs(u[0].email, 'SITE_INFO_UPDATED').catch(err => console.warn('⚠️ CRM site info sync error:', err.message));
        }
      } catch (syncErr) {
        console.warn('⚠️ Failed to sync site info to CRMs:', syncErr.message);
      }
    }

    res.json({ success: true, updated: updatedCount > 0 });
  } catch (err) {
    console.error('❌ Error updating site info:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/auth/account-exists
//  Check whether an account already exists for an email.
// ────────────────────────────────────────────────────────────
app.get('/api/auth/account-exists', async (req, res) => {
  try {
    const rawEmail = req.query.email;
    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const [rows] = await db.query(
      'SELECT id, is_verified FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );

    const exists = rows.length > 0 && Number(rows[0].is_verified) === 1;
    return res.json({ exists, unverified: rows.length > 0 && Number(rows[0].is_verified) === 0 });
  } catch (err) {
    console.error('❌ Error checking account existence:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  Authentication Stores & Helpers
// ────────────────────────────────────────────────────────────
// loginOtpStore & signupCodeStore imported from auth.js

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ────────────────────────────────────────────────────────────
//  POST /api/auth/send-otp
//  Passwordless login & registration: Sends 6-digit OTP code to user email.
// ────────────────────────────────────────────────────────────
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email, username, siteId, framerUserId, framerSiteName, framerSiteUrl, mode } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const resolvedUsername = (username || '').trim() || normalizedEmail.split('@')[0];

    // Check if user already exists
    const [existing] = await db.query(
      'SELECT id, username, is_verified, framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [normalizedEmail]
    );

    // If login mode is requested and account does not exist or was never verified, reject login and require signup
    if ((mode === 'login' || req.body.requireExisting) && (existing.length === 0 || Number(existing[0].is_verified) === 0)) {
      return res.status(404).json({
        success: false,
        notFound: true,
        message: 'No account found with this email. Please sign up first.',
      });
    }

    let userId = null;
    let isExistingUser = false;

    if (existing.length > 0) {
      isExistingUser = true;
      userId = existing[0].id;
      // If user supplied a new name and old name was just email prefix, update it
      if (username && username.trim() && existing[0].username === normalizedEmail.split('@')[0]) {
        await db.query('UPDATE `reviewfic-userlogin` SET username = ? WHERE id = ?', [username.trim(), userId]);
      }
      if (framerSiteName || framerSiteUrl) {
        await db.query(
          'UPDATE `reviewfic-userlogin` SET framer_site_name = COALESCE(?, framer_site_name), framer_site_url = COALESCE(?, framer_site_url) WHERE id = ?',
          [framerSiteName || null, framerSiteUrl || null, userId]
        );
      }
    } else {
      // Upsert new passwordless user record
      const [insertResult] = await db.query(
        'INSERT INTO `reviewfic-userlogin` (username, email, password, is_verified, framer_site_name, framer_site_url) VALUES (?, ?, NULL, 0, ?, ?)',
        [resolvedUsername, normalizedEmail, framerSiteName || null, framerSiteUrl || null]
      );
      userId = insertResult.insertId;
    }

    const isNewSignup = !isExistingUser || Number(existing[0]?.is_verified) === 0;

    // Start trial if eligible and siteId is passed
    if (siteId) {
      try {
        await startTrial(normalizedEmail, siteId, framerUserId, 0, framerSiteName, framerSiteUrl);
      } catch (trialErr) {
        console.warn('⚠️ Non-blocking trial start failed on send-otp:', trialErr.message);
      }
    }

    // Generate 6-digit OTP code (15 minutes validity)
    const code = generateOtpCode();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const otpPayload = {
      code,
      expiresAt,
      userId,
      username: resolvedUsername,
      siteId,
      framerUserId,
      framerSiteName: framerSiteName || existing[0]?.framer_site_name || null,
      framerSiteUrl: framerSiteUrl || existing[0]?.framer_site_url || null,
      isNewSignup,
    };
    loginOtpStore.set(normalizedEmail, otpPayload);
    signupCodeStore.set(normalizedEmail, otpPayload);

    // Send email via template
    const templatePath = path.join(__dirname, 'mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    const headerTitle = isExistingUser ? 'Your Sign-in Code' : 'Verify your email';
    const headerSub = isExistingUser
      ? 'Use this code to complete your passwordless login'
      : 'Confirm your email to complete registration';
    const bodyText = `Use the 6-digit verification code below to access your <strong style="color: #8aa2ff; font-weight: 700;">Framefic</strong> account. This code expires in <strong style="color: #8aa2ff; font-weight: 700;">15 minutes</strong>.`;

    htmlContent = htmlContent
      .replace('{title}', isExistingUser ? 'Sign-in Code' : 'Verify Email')
      .replace('{header_title}', headerTitle)
      .replace('{header_subtitle}', headerSub)
      .replace('{body_text}', bodyText)
      .replace('{username}', resolvedUsername)
      .replace('{code}', code)
      .replace(/{year}/g, String(new Date().getFullYear()));

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress(),
      },
      to: normalizedEmail,
      subject: isExistingUser ? 'Your Framefic Sign-in Code' : 'Verify your Framefic Account',
      html: htmlContent,
      attachments: [
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
        {
          filename: 'wave.png',
          path: waveImagePath,
          cid: 'wave-image',
        },
      ],
    });

    console.log(`📧 OTP code sent to ${normalizedEmail} [Code: ${code}] (isExistingUser: ${isExistingUser})`);
    return res.json({
      success: true,
      isExistingUser,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}.`,
    });
  } catch (err) {
    console.error('❌ Error sending OTP:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/verify-otp
//  Verifies 6-digit OTP and authenticates/logs in the user.
// ────────────────────────────────────────────────────────────
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const rawCode = req.body.code;

    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and verification code are required.' });
    }

    const otpEntry = loginOtpStore.get(email) || signupCodeStore.get(email);
    if (!otpEntry) {
      return res.status(400).json({ message: 'No verification code was requested for this email, or it has expired.' });
    }

    if (Date.now() > otpEntry.expiresAt) {
      loginOtpStore.delete(email);
      signupCodeStore.delete(email);
      return res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });
    }

    if (otpEntry.code !== code) {
      return res.status(400).json({ message: 'Invalid verification code. Please check and try again.' });
    }

    // Determine whether this user was unverified prior to activating
    const [existingRows] = await db.query(
      'SELECT id, username, email, is_verified, framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );
    const wasUnverified = existingRows.length === 0 || Number(existingRows[0].is_verified) === 0;
    const isNewSignup = Boolean(otpEntry.isNewSignup ?? wasUnverified);

    // Activate and mark user as verified in DB
    await db.query(
      'UPDATE `reviewfic-userlogin` SET is_verified = 1 WHERE email = ?',
      [email]
    );

    // Persist framer site name / url if provided in otpEntry and missing in DB
    const effectiveSiteName = otpEntry?.framerSiteName || existingRows[0]?.framer_site_name || null;
    const effectiveSiteUrl = otpEntry?.framerSiteUrl || existingRows[0]?.framer_site_url || null;
    if (effectiveSiteName || effectiveSiteUrl) {
      await db.query(
        'UPDATE `reviewfic-userlogin` SET framer_site_name = COALESCE(framer_site_name, ?), framer_site_url = COALESCE(framer_site_url, ?) WHERE email = ?',
        [effectiveSiteName, effectiveSiteUrl, email]
      ).catch(() => { });
    }

    // Retrieve fresh user info
    const [users] = await db.query(
      'SELECT id, username, email, framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User account not found.' });
    }

    const user = users[0];

    // Trigger unified CRM user sync (FluentCRM & CRMfic)
    syncUserToAllCRMs(user.id, isNewSignup ? 'USER_REGISTERED' : 'USER_VERIFIED').catch(err => {
      console.warn('⚠️ [CRM Webhook] User verify sync error:', err.message);
    });

    // Send team notification on new passwordless user registration
    if (isNewSignup) {
      sendTeamSignupNotification({
        username: user.username,
        email: user.email,
        source: 'Email Sign-up',
        userId: user.id,
        framerSiteName: user.framer_site_name || effectiveSiteName || null,
        framerSiteUrl: user.framer_site_url || effectiveSiteUrl || null,
      }).catch(err => console.error('⚠️ Team signup notification error:', err.message));
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    loginOtpStore.delete(email);
    signupCodeStore.delete(email);
    console.log(`✅ User authenticated via OTP successfully: ${email} (isNewSignup: ${isNewSignup})`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('❌ Error verifying OTP:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/register
//  Initiates registration by sending a verification email (password optional).
// ────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, siteId, framerUserId } = req.body || {};

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const resolvedUsername = (username || '').trim() || normalizedEmail.split('@')[0];

    // Check if email already exists and is verified
    const [existing] = await db.query(
      'SELECT id, is_verified FROM `reviewfic-userlogin` WHERE email = ?',
      [normalizedEmail]
    );

    let passwordHash = null;
    if (password && typeof password === 'string' && password.length >= 6) {
      passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    }

    if (existing.length > 0) {
      if (existing[0].is_verified === 1) {
        // For passwordless flow, if user already exists, seamlessly send sign-in OTP!
        const code = generateOtpCode();
        const expiresAt = Date.now() + 15 * 60 * 1000;
        loginOtpStore.set(normalizedEmail, { code, expiresAt });
        signupCodeStore.set(normalizedEmail, { code, expiresAt });

        const templatePath = path.join(__dirname, 'mail.html');
        let htmlContent = await fs.readFile(templatePath, 'utf-8');
        htmlContent = htmlContent
          .replace('{title}', 'Sign-in Code')
          .replace('{header_title}', 'Your Sign-in Code')
          .replace('{header_subtitle}', 'Use this code to complete your passwordless login')
          .replace('{body_text}', 'Use the 6-digit verification code below to access your <strong style="color: #8aa2ff; font-weight: 700;">Framefic</strong> account. This code expires in <strong style="color: #8aa2ff; font-weight: 700;">15 minutes</strong>.')
          .replace('{username}', resolvedUsername)
          .replace('{code}', code)
          .replace(/{year}/g, String(new Date().getFullYear()));

        await smtpTransporter.sendMail({
          from: { name: 'Framefic', address: getCleanFromAddress() },
          to: normalizedEmail,
          subject: 'Your Framefic Sign-in Code',
          html: htmlContent,
          attachments: [
            { filename: 'Framefic.png', path: frameficLogoPath, cid: 'framefic-logo' },
            { filename: 'wave.png', path: waveImagePath, cid: 'wave-image' },
          ],
        });

        return res.json({ success: true, message: 'Verification code sent to your email.' });
      }
      // If it exists but is not verified, overwrite username and optional password
      await db.query(
        'UPDATE `reviewfic-userlogin` SET username = ?, password = COALESCE(?, password) WHERE id = ?',
        [resolvedUsername, passwordHash, existing[0].id]
      );
    } else {
      // Insert unverified user
      await db.query(
        'INSERT INTO `reviewfic-userlogin` (username, email, password, is_verified) VALUES (?, ?, ?, 0)',
        [resolvedUsername, normalizedEmail, passwordHash]
      );
    }

    // Start trial if eligible and siteId is passed
    if (siteId) {
      try {
        await startTrial(normalizedEmail, siteId, framerUserId);
      } catch (trialErr) {
        console.warn('⚠️ Non-blocking trial start failed on register:', trialErr.message);
      }
    }

    // Generate signup verification code
    const code = generateOtpCode();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    signupCodeStore.set(normalizedEmail, { code, expiresAt });
    loginOtpStore.set(normalizedEmail, { code, expiresAt });

    const templatePath = path.join(__dirname, 'mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    htmlContent = htmlContent
      .replace('{title}', 'Verify Email')
      .replace('{header_title}', 'Verify your email')
      .replace('{header_subtitle}', 'Confirm your email to complete registration')
      .replace('{body_text}', 'Use the code below to verify your <strong style="color: #8aa2ff; font-weight: 700;">Framefic</strong> account. This code expires in <strong style="color: #8aa2ff; font-weight: 700;">15 minutes</strong>.')
      .replace('{username}', resolvedUsername)
      .replace('{code}', code)
      .replace(/{year}/g, String(new Date().getFullYear()));

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress(),
      },
      to: normalizedEmail,
      subject: 'Verify your Framefic Account',
      html: htmlContent,
      attachments: [
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
        {
          filename: 'wave.png',
          path: waveImagePath,
          cid: 'wave-image',
        },
      ],
    });

    console.log(`📧 Signup verification code sent to ${normalizedEmail} [Code: ${code}]`);
    return res.json({ success: true, message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error('❌ Error during register request:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/verify-signup
//  Verify the signup code and complete registration (activate user).
// ────────────────────────────────────────────────────────────
app.post('/api/auth/verify-signup', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const rawCode = req.body.code;
    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and code are required.' });
    }

    const entry = signupCodeStore.get(email) || loginOtpStore.get(email);
    if (!entry) {
      return res.status(400).json({ message: 'No verification code found. Please request a new one.' });
    }
    if (Date.now() > entry.expiresAt) {
      signupCodeStore.delete(email);
      loginOtpStore.delete(email);
      return res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });
    }
    if (entry.code !== code) {
      return res.status(400).json({ message: 'Incorrect verification code. Please try again.' });
    }

    // Verify the user in the database
    const [result] = await db.query(
      'UPDATE `reviewfic-userlogin` SET is_verified = 1 WHERE email = ?',
      [email]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Retrieve fresh user info
    const [users] = await db.query(
      'SELECT id, username, email FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );
    const user = users[0];

    // Trigger unified CRM user registration sync (FluentCRM & CRMfic)
    syncUserToAllCRMs(user.id, 'USER_REGISTERED').catch(err => {
      console.warn('⚠️ [CRM Webhook] Signup verify sync error:', err.message);
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    signupCodeStore.delete(email);
    loginOtpStore.delete(email);
    console.log(`✅ User registered and verified successfully: ${email}`);

    sendTeamSignupNotification({
      username: user.username,
      email: user.email,
      source: 'Email Registration',
      userId: user.id,
    }).catch(err => console.error('⚠️ Team signup notification error:', err.message));

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('❌ Error verifying signup:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/login
//  Passwordless or password-based login router.
// ────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, code } = req.body || {};

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Case 1: If OTP code is provided, verify OTP and authenticate
    if (code) {
      const rawCode = String(code).trim();
      const otpEntry = loginOtpStore.get(normalizedEmail) || signupCodeStore.get(normalizedEmail);
      if (!otpEntry || otpEntry.code !== rawCode || Date.now() > otpEntry.expiresAt) {
        return res.status(400).json({ message: 'Invalid or expired verification code.' });
      }

      const [existingRows] = await db.query(
        'SELECT id, username, email, is_verified, framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
        [normalizedEmail]
      );
      const wasUnverified = existingRows.length === 0 || Number(existingRows[0].is_verified) === 0;
      const isNewSignup = Boolean(otpEntry.isNewSignup ?? wasUnverified);

      await db.query('UPDATE `reviewfic-userlogin` SET is_verified = 1 WHERE email = ?', [normalizedEmail]);
      const [users] = await db.query('SELECT id, username, email, framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1', [normalizedEmail]);
      if (users.length === 0) {
        return res.status(404).json({ message: 'User not found.' });
      }
      const user = users[0];
      syncUserToAllCRMs(user.id, isNewSignup ? 'USER_REGISTERED' : 'USER_LOGIN').catch(() => { });

      if (isNewSignup) {
        sendTeamSignupNotification({
          username: user.username,
          email: user.email,
          source: 'Email sign-up',
          userId: user.id,
          framerSiteName: user.framer_site_name || otpEntry?.framerSiteName || null,
          framerSiteUrl: user.framer_site_url || otpEntry?.framerSiteUrl || null,
        }).catch(err => console.error('⚠️ Team signup notification error:', err.message));
      }

      const token = jwt.sign({ userId: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
      loginOtpStore.delete(normalizedEmail);
      signupCodeStore.delete(normalizedEmail);
      return res.json({ success: true, token, user });
    }

    // Case 2: If no password is provided, initiate passwordless OTP send
    if (!password) {
      const [existing] = await db.query('SELECT id, username, is_verified FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1', [normalizedEmail]);
      if (existing.length === 0 || Number(existing[0].is_verified) === 0) {
        return res.status(404).json({
          success: false,
          notFound: true,
          message: 'No account found with this email. Please sign up first.',
        });
      }

      const code = generateOtpCode();
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const resolvedUsername = existing[0]?.username || normalizedEmail.split('@')[0];

      const otpPayload = { code, expiresAt, isNewSignup: false };
      loginOtpStore.set(normalizedEmail, otpPayload);
      signupCodeStore.set(normalizedEmail, otpPayload);

      const templatePath = path.join(__dirname, 'mail.html');
      let htmlContent = await fs.readFile(templatePath, 'utf-8');
      htmlContent = htmlContent
        .replace('{title}', 'Sign-in Code')
        .replace('{header_title}', 'Your Sign-in Code')
        .replace('{header_subtitle}', 'Use this code to complete your passwordless login')
        .replace('{body_text}', 'Use the 6-digit verification code below to sign in to your <strong style="color: #8aa2ff; font-weight: 700;">Framefic</strong> account. This code expires in <strong style="color: #8aa2ff; font-weight: 700;">15 minutes</strong>.')
        .replace('{username}', resolvedUsername)
        .replace('{code}', code)
        .replace(/{year}/g, String(new Date().getFullYear()));

      await smtpTransporter.sendMail({
        from: { name: 'Framefic', address: getCleanFromAddress() },
        to: normalizedEmail,
        subject: 'Your Framefic Sign-in Code',
        html: htmlContent,
        attachments: [
          { filename: 'Framefic.png', path: frameficLogoPath, cid: 'framefic-logo' },
          { filename: 'wave.png', path: waveImagePath, cid: 'wave-image' },
        ],
      });

      return res.json({ success: true, message: 'Verification code sent to your email.' });
    }

    // Case 3: Legacy password check (backward compatibility)
    const [users] = await db.query(
      'SELECT id, username, email, password, is_verified FROM `reviewfic-userlogin` WHERE email = ?',
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = users[0];
    if (user.password) {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('❌ Error logging in user:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/auth/me
//  Get current user from JWT token.
// ────────────────────────────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Fetch fresh user data from DB
    const [users] = await db.query(
      'SELECT id, username, email, avatar_url FROM `reviewfic-userlogin` WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = users[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url || null,
      },
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token.' });
    }
    console.error('❌ Error fetching user:', err);
    res.status(500).json({ message: err.message });
  }
});

// socialAuthSessions & socialSessionMetadata imported from auth.js

// ────────────────────────────────────────────────────────────
//  GET /api/auth/social-status
//  Checks if the social auth session is authenticated.
// ────────────────────────────────────────────────────────────
app.get('/api/auth/social-status', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  const session = socialAuthSessions.get(sessionId);
  if (session) {
    if (session.status === 'authenticated') {
      socialAuthSessions.delete(sessionId);
      return res.json({
        status: 'authenticated',
        token: session.token,
        user: session.user
      });
    }
  }

  return res.json({ status: 'pending' });
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/social-verify-code
//  Verifies the 6-digit code entered manually in the plugin.
// ────────────────────────────────────────────────────────────
app.post('/api/auth/social-verify-code', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  const cleanCode = String(code).trim();
  const session = socialAuthSessions.get(cleanCode);
  if (session && session.status === 'authenticated') {
    socialAuthSessions.delete(cleanCode);
    return res.json({
      success: true,
      token: session.token,
      user: session.user
    });
  }

  return res.status(400).json({ error: 'Invalid or expired code. Please try again.' });
});

// ────────────────────────────────────────────────────────────
//  Google & Facebook Social Authentication & Dev-Mode Mocks
// ────────────────────────────────────────────────────────────

function getBaseUrl(req) {
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL.replace(/\/+$/, '');
  }
  const protocol = req.protocol;
  const host = req.get('host') || '';
  if (host.includes('app.framefic.com') || req.originalUrl.includes('/reviewfic')) {
    return `${protocol}://${host}/reviewfic`;
  }
  return `${protocol}://${host}`;
}

// GET /api/auth/google
app.get('/api/auth/google', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = resolveGoogleRedirectUri(req);
  const sessionId = req.query.sessionId || '';
  const siteName = req.query.siteName || '';
  const siteUrl = req.query.siteUrl || '';
  const siteId = req.query.siteId || '';

  if (sessionId) {
    socialSessionMetadata.set(sessionId, { siteName, siteUrl, siteId });
    setTimeout(() => socialSessionMetadata.delete(sessionId), 15 * 60 * 1000);
  }

  // If credentials are not configured or are set to placeholders, render the Developer Mock Screen
  if (!googleClientId || googleClientId.trim() === '' || googleClientId === 'your_google_client_id') {
    return renderMockLoginScreen(res, 'google', redirectUri, sessionId);
  }

  console.log(`🔑 Initiating Google OAuth with redirect_uri: ${redirectUri}`);

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(googleClientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=email%20profile` +
    `&prompt=select_account` +
    `&state=${encodeURIComponent(sessionId)}`;

  res.redirect(authUrl);
});

// GET /api/auth/google/callback
app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const sessionId = state || null;
  if (error) {
    return res.status(400).send(`OAuth Error: ${error}`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveGoogleRedirectUri(req);
  console.log(`🔑 [Google OAuth] Exchanging token with redirect_uri: ${redirectUri}`);

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Google Token Exchange Failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();

    // Fetch user profile
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userinfoResponse.ok) {
      throw new Error('Failed to fetch userinfo from Google.');
    }

    const profile = await userinfoResponse.json();

    if (!profile.email) {
      throw new Error('Google account has no associated email address.');
    }

    const email = profile.email.toLowerCase().trim();
    const googleId = profile.sub;
    const username = profile.name || email.split('@')[0];
    const avatarUrl = profile.picture || null;

    const sessionMeta = (sessionId && socialSessionMetadata.get(sessionId)) || {};
    const result = await handleSocialUserSignup(email, username, googleId, null, avatarUrl, sessionMeta);

    sendSocialAuthSuccessMessage(res, result.token, result.user, sessionId);
  } catch (err) {
    console.error('❌ Google Callback Error:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// GET /api/auth/facebook
app.get('/api/auth/facebook', (req, res) => {
  const facebookAppId = process.env.FACEBOOK_APP_ID;
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/facebook/callback`;
  const sessionId = req.query.sessionId || '';
  const siteName = req.query.siteName || '';
  const siteUrl = req.query.siteUrl || '';
  const siteId = req.query.siteId || '';

  if (sessionId) {
    socialSessionMetadata.set(sessionId, { siteName, siteUrl, siteId });
    setTimeout(() => socialSessionMetadata.delete(sessionId), 15 * 60 * 1000);
  }

  if (!facebookAppId || facebookAppId.trim() === '' || facebookAppId === 'your_facebook_app_id') {
    return renderMockLoginScreen(res, 'facebook', redirectUri, sessionId);
  }

  const authUrl = `https://www.facebook.com/v12.0/dialog/oauth?` +
    `client_id=${encodeURIComponent(facebookAppId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=email,public_profile` +
    `&state=${encodeURIComponent(sessionId)}`;

  res.redirect(authUrl);
});

// GET /api/auth/facebook/callback
app.get('/api/auth/facebook/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const sessionId = state || null;
  if (error) {
    return res.status(400).send(`OAuth Error: ${error}`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  const facebookAppId = process.env.FACEBOOK_APP_ID;
  const facebookAppSecret = process.env.FACEBOOK_APP_SECRET;
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/facebook/callback`;

  try {
    // Exchange code for token
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v12.0/oauth/access_token?` +
      `client_id=${facebookAppId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${facebookAppSecret}` +
      `&code=${code}`
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Facebook Token Exchange Failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();

    // Fetch profile
    const profileResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${tokens.access_token}`
    );

    if (!profileResponse.ok) {
      throw new Error('Failed to fetch profile from Facebook.');
    }

    const profile = await profileResponse.json();

    const email = (profile.email || `${profile.id}@facebook.com`).toLowerCase().trim();
    const facebookId = profile.id;
    const username = profile.name || email.split('@')[0];
    const avatarUrl = profile.picture?.data?.url || null;

    const sessionMeta = (sessionId && socialSessionMetadata.get(sessionId)) || {};
    const result = await handleSocialUserSignup(email, username, null, facebookId, avatarUrl, sessionMeta);

    sendSocialAuthSuccessMessage(res, result.token, result.user, sessionId);
  } catch (err) {
    console.error('❌ Facebook Callback Error:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// POST /api/auth/mock/callback
app.post('/api/auth/mock/callback', async (req, res) => {
  const { email, username, provider, state } = req.body;
  const sessionId = state || null;
  if (!email || !username) {
    return res.status(400).send('Email and Name are required for mock authentication.');
  }

  try {
    const resolvedEmail = email.toLowerCase().trim();
    const mockId = `mock-${provider}-${Date.now()}`;
    const googleId = provider === 'google' ? mockId : null;
    const facebookId = provider === 'facebook' ? mockId : null;
    const avatarUrl = provider === 'google'
      ? 'https://lh3.googleusercontent.com/a/default-user'
      : 'https://platform-lookaside.fbsbx.com/platform/profilepic/';

    const sessionMeta = (sessionId && socialSessionMetadata.get(sessionId)) || {};
    const result = await handleSocialUserSignup(resolvedEmail, username, googleId, facebookId, avatarUrl, sessionMeta);

    sendSocialAuthSuccessMessage(res, result.token, result.user, sessionId);
  } catch (err) {
    console.error('❌ Mock Callback Error:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// Helper: Forward Google / Social signup details to Webhooks (FluentCRM & CRMfic)
export async function sendSocialSignupWebhook({ email, username, googleId = null, facebookId = null, avatarUrl = null }) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) return;

  const nameParts = (username || '').trim().split(' ');
  const firstName = nameParts[0] || normalizedEmail.split('@')[0] || '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  const results = await Promise.allSettled([
    forwardToFluentCRM({
      email: normalizedEmail,
      username,
      firstName,
      lastName,
      status: 'subscribed',
      list: ['App Users', 'Reviewfic'],
      tags: ['Reviewfic', 'Reviewfic-Status-Trialing'],
      event: 'social_signup',
    }),
    forwardToCRMfic({
      email: normalizedEmail,
      username,
      firstName,
      lastName,
      status: 'Subscribed',
      list: ['App Users', 'Reviewfic'],
      tags: ['Reviewfic', 'Reviewfic-Status-Trialing'],
      event: 'social_signup',
    }),
  ]);

  const fluentOk = results[0].status === 'fulfilled' && results[0].value;
  const crmficOk = results[1].status === 'fulfilled' && results[1].value;
  console.log(`📤 Social signup CRM webhook sync for ${normalizedEmail}: FluentCRM=${fluentOk ? 'OK' : 'Skipped/Failed'}, CRMfic=${crmficOk ? 'OK' : 'Skipped/Failed'}`);
}

// Helper: Handle Social User Signup/Signin logic
async function handleSocialUserSignup(email, username, googleId, facebookId, avatarUrl, siteMetadata = {}) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) throw new Error('Email is required for social authentication.');

  // Check if email already exists
  const [existing] = await db.query(
    'SELECT id, username, google_id, facebook_id, avatar_url, is_verified, framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ?',
    [normalizedEmail]
  );

  let userId;
  let finalAvatarUrl = avatarUrl;
  const isNewUser = existing.length === 0;
  const wasUnverified = isNewUser || Number(existing[0]?.is_verified) === 0;
  const isNewSignup = wasUnverified;

  const resolvedSiteName = siteMetadata.siteName || existing[0]?.framer_site_name || null;
  const resolvedSiteUrl = siteMetadata.siteUrl || existing[0]?.framer_site_url || null;

  if (!isNewUser) {
    userId = existing[0].id;
    finalAvatarUrl = existing[0].avatar_url || avatarUrl;
    const isNewGoogleConnect = Boolean(googleId && !existing[0].google_id);

    // Google/Facebook confirms identity: ensure verified
    await db.query('UPDATE `reviewfic-userlogin` SET is_verified = 1 WHERE id = ?', [userId]);

    // Update IDs if missing
    if (googleId && !existing[0].google_id) {
      await db.query('UPDATE `reviewfic-userlogin` SET google_id = ? WHERE id = ?', [googleId, userId]);
    }
    if (facebookId && !existing[0].facebook_id) {
      await db.query('UPDATE `reviewfic-userlogin` SET facebook_id = ? WHERE id = ?', [facebookId, userId]);
    }
    if (avatarUrl && existing[0].avatar_url !== avatarUrl) {
      await db.query('UPDATE `reviewfic-userlogin` SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);
      finalAvatarUrl = avatarUrl;
    }

    // If username is better from social profile (e.g. real name instead of email prefix)
    if (username && username.trim() && (!existing[0].username || existing[0].username === normalizedEmail.split('@')[0])) {
      await db.query('UPDATE `reviewfic-userlogin` SET username = ? WHERE id = ?', [username.trim(), userId]);
    }

    // Persist framer site metadata if provided and previously missing
    if (resolvedSiteName || resolvedSiteUrl) {
      await db.query(
        'UPDATE `reviewfic-userlogin` SET framer_site_name = COALESCE(framer_site_name, ?), framer_site_url = COALESCE(framer_site_url, ?) WHERE id = ?',
        [resolvedSiteName, resolvedSiteUrl, userId]
      ).catch(() => { });
    }

    // Start trial if siteId is present and user was previously unverified
    if (siteMetadata.siteId && wasUnverified) {
      try {
        await startTrial(normalizedEmail, siteMetadata.siteId, null, 0, resolvedSiteName, resolvedSiteUrl);
      } catch (trialErr) {
        console.warn('⚠️ Non-blocking trial start failed on social signup:', trialErr.message);
      }
    }

    // If previously unverified, this social connection marks their completed signup!
    if (isNewSignup) {
      sendTeamSignupNotification({
        username: username || existing[0].username || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        source: googleId ? 'Google Sign-up' : facebookId ? 'Facebook Sign-up' : 'Social Sign-up',
        userId: userId,
        framerSiteName: resolvedSiteName,
        framerSiteUrl: resolvedSiteUrl,
      }).catch(err => console.error('⚠️ Team signup notification error:', err.message));

      syncUserToAllCRMs(userId, 'USER_REGISTERED').catch(err => {
        console.warn('⚠️ [CRM Webhook] Social signup sync error:', err.message);
      });
    }

    if (isNewGoogleConnect) {
      sendSocialSignupWebhook({
        email: normalizedEmail,
        username: existing[0].username || username,
        googleId,
        facebookId,
        avatarUrl: finalAvatarUrl,
      }).catch(err => console.error('⚠️ Social signup webhook error:', err.message));
    }
  } else {
    // Insert brand new user with verified status (OAuth verified)
    const [insertResult] = await db.query(
      'INSERT INTO `reviewfic-userlogin` (username, email, password, google_id, facebook_id, avatar_url, is_verified, framer_site_name, framer_site_url) VALUES (?, ?, NULL, ?, ?, ?, 1, ?, ?)',
      [username || normalizedEmail.split('@')[0], normalizedEmail, googleId, facebookId, avatarUrl, resolvedSiteName, resolvedSiteUrl]
    );
    userId = insertResult.insertId;

    // Start trial if siteId is passed
    if (siteMetadata.siteId) {
      try {
        await startTrial(normalizedEmail, siteMetadata.siteId, null, 0, resolvedSiteName, resolvedSiteUrl);
      } catch (trialErr) {
        console.warn('⚠️ Non-blocking trial start failed on social signup:', trialErr.message);
      }
    }

    sendTeamSignupNotification({
      username: username || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      source: googleId ? 'Google Sign-up' : facebookId ? 'Facebook Sign-up' : 'Social Sign-up',
      userId: userId,
      framerSiteName: resolvedSiteName,
      framerSiteUrl: resolvedSiteUrl,
    }).catch(err => console.error('⚠️ Team signup notification error:', err.message));

    // Push new social user to webhook and CRM sync engine
    sendSocialSignupWebhook({
      email: normalizedEmail,
      username: username || normalizedEmail.split('@')[0],
      googleId,
      facebookId,
      avatarUrl: finalAvatarUrl,
    }).catch(err => console.error('⚠️ Social signup webhook error:', err.message));

    syncUserToAllCRMs(userId, 'USER_REGISTERED').catch(err => {
      console.warn('⚠️ [CRM Webhook] Social signup sync error:', err.message);
    });
  }

  const finalUsername = username || (existing[0]?.username) || normalizedEmail.split('@')[0];

  // Generate JWT token
  const token = jwt.sign(
    { userId, email: normalizedEmail, username: finalUsername },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  return {
    token,
    user: {
      id: userId,
      username: finalUsername,
      email: normalizedEmail,
      avatar_url: finalAvatarUrl,
    }
  };
}

// Helper: Renders modern and premium HTML developer screen for mock social login
function renderMockLoginScreen(res, provider, redirectUri, sessionId = '') {
  const capitalizedProvider = provider.charAt(0).toUpperCase() + provider.slice(1);
  const color = provider === 'google' ? '#4285F4' : '#1877F2';

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Developer Mock Social Auth</title>
      <style>
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background: #0F172A;
          color: #E2E8F0;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .card {
          background: #1E293B;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 32px;
          max-width: 420px;
          width: 90%;
          text-align: center;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
        }
        .badge {
          background: rgba(234, 179, 8, 0.15);
          color: #FBBF24;
          border: 1px solid rgba(234, 179, 8, 0.25);
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          display: inline-block;
          margin-bottom: 16px;
        }
        h2 {
          font-size: 20px;
          margin: 0 0 8px 0;
          font-weight: 600;
        }
        p {
          font-size: 13px;
          color: #94A3B8;
          line-height: 1.5;
          margin: 0 0 24px 0;
        }
        .form-group {
          margin-bottom: 16px;
          text-align: left;
        }
        label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 6px;
          color: #94A3B8;
        }
        input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 6px;
          border: 1px solid #475569;
          background: #0F172A;
          color: #F8FAFC;
          font-size: 13px;
          box-sizing: border-box;
        }
        input:focus {
          border-color: ${color};
          outline: none;
        }
        button {
          width: 100%;
          background: ${color};
          color: white;
          border: none;
          padding: 12px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: filter 0.2s;
        }
        button:hover {
          filter: brightness(1.1);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="badge">Local Dev Mode</span>
        <h2>Simulate ${capitalizedProvider} Sign In</h2>
        <p>Your <code>.env</code> file is missing <code>${provider.toUpperCase()}_${provider === 'google' ? 'CLIENT_ID' : 'APP_ID'}</code>. Real OAuth is bypassed, but you can enter mock data to test the integration flow:</p>
        
        <form action="/api/auth/mock/callback" method="POST">
          <input type="hidden" name="provider" value="${provider}" />
          <input type="hidden" name="state" value="${sessionId}" />
          <div class="form-group">
            <label for="username">Full Name</label>
            <input type="text" id="username" name="username" value="Social Tester" required />
          </div>
          <div class="form-group">
            <label for="email">Email Address</label>
            <input type="email" id="email" name="email" value="tester@${provider}.com" required />
          </div>
          <button type="submit">Authenticate Mock User</button>
        </form>
      </div>
    </body>
    </html>
  `);
}

// Helper: Send verification code email via SMTP
async function sendSocialVerificationEmail(user, shortCode) {
  if (!user || !user.email) return;
  const email = user.email.toLowerCase().trim();
  const rawUsername = user.username;
  const userName = typeof rawUsername === 'string' && rawUsername.trim()
    ? rawUsername.trim()
    : 'there';

  try {
    const templatePath = path.join(__dirname, 'mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    htmlContent = htmlContent
      .replace('{title}', 'Sync Plugin')
      .replace('{header_title}', 'Sync with Plugin')
      .replace('{header_subtitle}', 'Complete authorization to return to the plugin')
      .replace('{body_text}', 'If the plugin did not automatically log you in, use the 6-digit verification code below to sync manually. This code is valid for <strong style="color: #8aa2ff; font-weight: 700;">10 minutes</strong>.')
      .replace('{username}', userName)
      .replace('{code}', shortCode)
      .replace(/{year}/g, String(new Date().getFullYear()));

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: email,
      subject: 'Your Framefic Social Verification Code',
      html: htmlContent,
      attachments: [
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
        {
          filename: 'wave.png',
          path: waveImagePath,
          cid: 'wave-image',
        },
      ],
    });
    console.log(`📧 Social verification email automatically sent to ${email}`);
  } catch (mailErr) {
    console.error('❌ Failed to send social verification email:', mailErr);
  }
}

// GET /api/auth/social-check
// Checks if the session has been retrieved and deleted by the plugin.
app.get('/api/auth/social-check', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }
  // If the session was deleted, it means the plugin fetched it via polling
  const retrieved = !socialAuthSessions.has(sessionId);
  res.json({ retrieved });
});

// GET /api/auth/social-manual
// Renders the "Authentication Complete" fallback manual page when auto-sync failed.
app.get('/api/auth/social-manual', (req, res) => {
  const { sessionId, shortCode, email, username } = req.query;

  let logoBase64 = '';
  let waveBase64 = '';
  try {
    logoBase64 = readFileSync(frameficLogoPath).toString('base64');
  } catch (err) { }
  try {
    waveBase64 = readFileSync(waveImagePath).toString('base64');
  } catch (err) { }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Framefic – Sync Plugin</title>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        body {
          margin: 0;
          padding: 0;
          background-color: #09090e;
          font-family: 'DM Sans', Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          box-sizing: border-box;
          padding: 24px;
        }
        .card {
          max-width: 580px;
          width: 100%;
          background-color: #222121;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1), 0 16px 48px rgba(0,0,0,0.3);
        }
        .header {
          background-color: #5271ff;
          padding: 32px 32px 28px;
        }
        .header-nav {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          margin-bottom: 20px;
        }
        .logo-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .logo-text {
          font-family: 'Sora', 'DM Sans', Arial, sans-serif;
          font-size: 18px;
          font-weight: 800;
          color: #ffffff;
          letter-spacing: -0.3px;
        }
        .header h1 {
          font-family: 'Sora', 'DM Sans', Arial, sans-serif;
          font-size: 27px;
          font-weight: 800;
          color: #ffffff;
          letter-spacing: -0.5px;
          line-height: 1.15;
          margin: 15px 0 5px 0;
        }
        .header p {
          font-family: 'DM Sans', Arial, sans-serif;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.62);
          margin: 0;
        }
        .wave-container {
          line-height: 0;
          font-size: 0;
          background-color: #5271ff;
        }
        .wave-container img {
          width: 100%;
          height: auto;
          display: block;
        }
        .body-content {
          padding: 32px;
          background-color: #222121;
          text-align: left;
        }
        .greeting {
          font-size: 15px;
          color: #cbd5f5;
          margin: 0 0 10px 0;
        }
        .description {
          font-size: 14.5px;
          color: #b3b9d1;
          line-height: 1.75;
          margin: 0 0 24px 0;
        }
        .code-box {
          background-color: #171821;
          border: 1px dashed rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          margin-bottom: 24px;
        }
        .code-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: #898a8d;
          margin-bottom: 8px;
        }
        .code-value {
          font-family: 'Sora', monospace;
          font-size: 32px;
          font-weight: 800;
          color: #ffffff;
          letter-spacing: 6px;
        }
        hr {
          border: none;
          border-top: 1px solid #1c1e30;
          margin: 24px 0;
        }
        .footer {
          padding: 20px 32px;
          border-top: 1px solid #1c1e30;
          background-color: #222121;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          color: #898a8d;
        }
        .footer a {
          color: #8aa2ff;
          text-decoration: none;
          font-weight: 600;
        }
        .outer-footer {
          margin-top: 16px;
          text-align: center;
          font-size: 11px;
          color: #898a8d;
        }
      </style>
    </head>
    <body>
      <div>
        <div class="card">
          <div class="header">
            <div class="header-nav">
              <div class="logo-container">
                ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Logo" style="width: 24px; height: 24px; display: block; border-radius: 5px;">` : ''}
                <span class="logo-text">Framefic</span>
              </div>
            </div>
            <h1>Authentication Complete</h1>
            <p>Sync your account with the plugin</p>
          </div>

          <div class="wave-container">
            ${waveBase64 ? `<img src="data:image/png;base64,${waveBase64}" alt="">` : ''}
          </div>

          <div class="body-content">
            <p class="greeting">Hi ${username || 'there'},</p>
            <p class="description">
              Google authentication was successful, but the plugin could not automatically sync. Please enter the verification code below in the plugin to sync manually:
            </p>

            <div class="code-box">
              <div class="code-title">Verification Code</div>
              <div class="code-value">${shortCode || ''}</div>
            </div>

            <p class="instruction" style="text-align: center; color: #cbd5f5; line-height: 1.6;">
              A verification code has also been sent to your email <strong>${email || ''}</strong>.
            </p>
          </div>

          <div class="footer">
            <span>Need help? <a href="https://framefic.com/support/" target="_blank">Get Support</a></span>
            <span>&copy; ${new Date().getFullYear()} Framefic</span>
          </div>
        </div>

        <div class="outer-footer">
          &copy; ${new Date().getFullYear()} Framefic. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `);
});

// Helper: Post token back to parent Framer plugin and close popup
function sendSocialAuthSuccessMessage(res, token, user, sessionId = null) {
  let shortCode = '';
  if (sessionId) {
    shortCode = String(Math.floor(100000 + Math.random() * 900000));
    const sessionData = { status: 'authenticated', token, user };
    socialAuthSessions.set(sessionId, sessionData);
    socialAuthSessions.set(shortCode, sessionData);

    // Auto-expire session data in 10 minutes to prevent memory leaks
    setTimeout(() => {
      socialAuthSessions.delete(sessionId);
      socialAuthSessions.delete(shortCode);
    }, 10 * 60 * 1000);

    // Send email with SMTP after 4 seconds only if the session was not retrieved/polled
    if (user && user.email) {
      setTimeout(async () => {
        if (socialAuthSessions.has(sessionId)) {
          console.log(`[Reviewfic] Session ${sessionId} not retrieved by plugin yet. Sending verification email...\n`);
          await sendSocialVerificationEmail(user, shortCode);
        }
      }, 4000);
    }
  }

  // Render a simple intermediate page that tries to auto-close / auto-sync and redirects if needed after 2.5 seconds
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Authenticating...</title>
      <style>
        body {
          background-color: #09090e;
          color: #ffffff;
          font-family: 'DM Sans', Arial, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
        .spinner {
          border: 4px solid rgba(255,255,255,0.1);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border-left-color: #5271ff;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div style="text-align: center;">
        <div class="spinner" style="margin: 0 auto 16px;"></div>
        <p id="status-text" style="font-size: 14px; color: #b3b9d1;">Completing authentication...</p>
      </div>
      <script>
        const sessionId = "${sessionId || ''}";
        const token = "${token}";
        const user = ${JSON.stringify(user)};
        const shortCode = "${shortCode}";

        // Try to post message back to plugin opener
        try {
          if (window.opener) {
            window.opener.postMessage({
              type: 'social-auth-success',
              token: token,
              user: user
            }, '*');
          }
        } catch (e) {
          console.error("postMessage failed:", e);
        }

        // Try to close immediately
        try {
          window.close();
        } catch (e) {}

        // Poll check status to see if the plugin retrieved the session
        let checkAttempts = 0;
        const interval = setInterval(async () => {
          checkAttempts++;
          if (!sessionId) {
            clearInterval(interval);
            return;
          }
          try {
            const res = await fetch('/api/auth/social-check?sessionId=' + sessionId);
            const data = await res.json();
            if (data.retrieved) {
              clearInterval(interval);
              try { window.close(); } catch(e) {}
              document.getElementById('status-text').textContent = "Authenticated successfully! You can close this tab.";
              return;
            }
          } catch (err) {}

          if (checkAttempts >= 10) { // 2.5 seconds (250ms * 10)
            clearInterval(interval);
            // Redirect to manual code sync card
            window.location.href = '/api/auth/social-manual?sessionId=' + sessionId + 
              '&shortCode=' + shortCode + 
              '&email=' + encodeURIComponent(user.email || '') + 
              '&username=' + encodeURIComponent(user.username || '');
          }
        }, 250);
      </script>
    </body>
    </html>
  `);
}
const sentPurchaseNotificationIds = new Set();
const sentSignupNotificationEmails = new Set();
const sentRecurringNotificationIds = new Set();
const sentCancellationNotificationIds = new Set();
const sentPaymentFailureNotificationIds = new Set();
const frameficBgMailPath = fileURLToPath(new URL('./assets/framefic-bg-mail.png', import.meta.url));

/**
 * Helper to check if team mail forwarding is bypassed.
 * Controlled via environment variable: BYPASS_TEAM_MAIL (true / false)
 */
export function isTeamMailBypassed() {
  const raw = (process.env.BYPASS_TEAM_MAIL || process.env.BYPASS_TEAM_EMAIL || '').toLowerCase().trim();
  if (!raw) return false;
  // If explicitly disabled
  if (['false', '0', 'no', 'off', 'disabled'].includes(raw)) return false;
  // If set to true, ture (common typo), 1, yes, on, enabled, bypass
  return ['true', 'ture', '1', 'yes', 'on', 'enabled', 'bypass'].includes(raw) || Boolean(raw);
}

/**
 * Send automatic team notification to hello@framefic.com on new user signup
 */
export async function sendTeamSignupNotification({ username, email, source = 'Email Registration', userId = 'N/A', framerSiteName = null, framerSiteUrl = null }) {
  try {
    if (isTeamMailBypassed()) {
      console.log(`⏭️ [Team Mail Bypass] Skipped sending signup notification to team for: ${email} (BYPASS_TEAM_MAIL is true)`);
      return;
    }

    const normalizedEmail = (email || '').toLowerCase().trim();
    if (!normalizedEmail) return;

    if (sentSignupNotificationEmails.has(normalizedEmail)) {
      console.log(`⏭️  Team signup notification already sent for ${normalizedEmail}, skipping duplicate.`);
      return;
    }
    sentSignupNotificationEmails.add(normalizedEmail);

    const teamRecipient = 'hello@framefic.com';

    // Auto-lookup site info from DB if missing or N/A
    if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && (normalizedEmail || userId)) {
      try {
        const [userRows] = await db.query(
          `SELECT framer_site_name, framer_site_url FROM \`reviewfic-userlogin\` WHERE email = ? OR id = ? LIMIT 1`,
          [normalizedEmail, userId && userId !== 'N/A' ? userId : 0]
        );
        if (userRows && userRows[0]) {
          if ((!framerSiteName || framerSiteName === 'N/A') && userRows[0].framer_site_name) {
            framerSiteName = userRows[0].framer_site_name;
          }
          if ((!framerSiteUrl || framerSiteUrl === 'N/A') && userRows[0].framer_site_url) {
            framerSiteUrl = userRows[0].framer_site_url;
          }
        }

        if ((!framerSiteName || framerSiteName === 'N/A') || (!framerSiteUrl || framerSiteUrl === 'N/A')) {
          const [trialRows] = await db.query(
            `SELECT site_name, site_url FROM reviewfic_trials WHERE email = ? ORDER BY id DESC LIMIT 1`,
            [normalizedEmail]
          );
          if (trialRows && trialRows[0]) {
            if ((!framerSiteName || framerSiteName === 'N/A') && trialRows[0].site_name) {
              framerSiteName = trialRows[0].site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && trialRows[0].site_url) {
              framerSiteUrl = trialRows[0].site_url;
            }
          }
        }

        if ((!framerSiteName || framerSiteName === 'N/A') || (!framerSiteUrl || framerSiteUrl === 'N/A')) {
          const [payRows] = await db.query(
            `SELECT site_name, site_url FROM payments WHERE email = ? ORDER BY id DESC LIMIT 1`,
            [normalizedEmail]
          );
          if (payRows && payRows[0]) {
            if ((!framerSiteName || framerSiteName === 'N/A') && payRows[0].site_name) {
              framerSiteName = payRows[0].site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && payRows[0].site_url) {
              framerSiteUrl = payRows[0].site_url;
            }
          }
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not lookup site info for signup notification:', dbErr.message);
      }
    }

    const templatePath = path.join(__dirname, 'team-signup-mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    const formattedDate = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' UTC';

    const formattedSiteName = framerSiteName && String(framerSiteName).trim() ? String(framerSiteName).trim() : 'N/A';
    const rawSiteUrl = framerSiteUrl && String(framerSiteUrl).trim() ? String(framerSiteUrl).trim() : null;
    const formattedSiteUrlLink = rawSiteUrl
      ? `<a href="${rawSiteUrl.startsWith('http') ? rawSiteUrl : 'https://' + rawSiteUrl}" target="_blank" style="color: #1d4ed8; text-decoration: underline;">${rawSiteUrl}</a>`
      : 'N/A';

    htmlContent = htmlContent
      .replace(/{username}/g, username || 'New User')
      .replace(/{email}/g, email || '')
      .replace(/{userId}/g, String(userId))
      .replace(/{source}/g, source)
      .replace(/{framerSiteName}/g, formattedSiteName)
      .replace(/{framerSiteUrl}/g, formattedSiteUrlLink)
      .replace(/{date}/g, formattedDate)
      .replace(/{year}/g, String(new Date().getFullYear()))
      .replace(/src="assets\/Favicon\.png"/g, 'src="cid:framefic-app-logo"')
      .replace(/src="assets\/Framefic\.png"/g, 'src="cid:framefic-logo"');

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: teamRecipient,
      subject: `New User Registration: ${username || email} (${source})`,
      html: htmlContent,
      attachments: [
        {
          filename: 'Favicon.png',
          path: frameficAppLogoPath,
          cid: 'framefic-app-logo',
        },
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
      ],
    });
    console.log(`📧 Team signup notification sent to ${teamRecipient} for user ${email} (Site: ${formattedSiteName})`);
  } catch (err) {
    console.error('❌ Failed to send team signup notification:', err.message);
  }
}

/**
 * Send automatic team notification to hello@framefic.com on new plan subscription purchase
 */
export async function sendTeamPurchaseNotification({ username, email, plan, amount, currency = 'USD', siteId = 'N/A', paymentId = 'N/A', couponCode = null, framerSiteName = null, framerSiteUrl = null }) {
  try {
    if (isTeamMailBypassed()) {
      console.log(`⏭️ [Team Mail Bypass] Skipped sending purchase notification to team for: ${email} (BYPASS_TEAM_MAIL is true)`);
      return;
    }

    if (paymentId && paymentId !== 'N/A') {
      if (sentPurchaseNotificationIds.has(paymentId)) {
        console.log(`⏭️  Team purchase notification already sent for transaction ${paymentId}, skipping.`);
        return;
      }
      sentPurchaseNotificationIds.add(paymentId);
    }

    if ((!framerSiteName || !framerSiteUrl) && email) {
      try {
        const [userRows] = await db.query(
          'SELECT framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
          [email.toLowerCase().trim()]
        );
        if (userRows && userRows.length > 0) {
          if (!framerSiteName && userRows[0].framer_site_name) {
            framerSiteName = userRows[0].framer_site_name;
          }
          if (!framerSiteUrl && userRows[0].framer_site_url) {
            framerSiteUrl = userRows[0].framer_site_url;
          }
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not lookup user site info for purchase notification:', dbErr.message);
      }
    }

    const teamRecipient = 'hello@framefic.com';
    const templatePath = path.join(__dirname, 'team-purchase-mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    const formattedDate = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' UTC';

    const formattedPlan = (plan || 'subscription').charAt(0).toUpperCase() + (plan || 'subscription').slice(1) + ' Plan';
    const formattedAmount = amount != null ? `$${Number(amount).toFixed(2)}` : 'N/A';
    const formattedCoupon = couponCode && String(couponCode).trim() && String(couponCode).trim() !== 'null' && String(couponCode).trim() !== 'undefined'
      ? String(couponCode).trim()
      : 'None';

    const formattedSiteName = framerSiteName && String(framerSiteName).trim() ? String(framerSiteName).trim() : 'N/A';
    const rawSiteUrl = framerSiteUrl && String(framerSiteUrl).trim() ? String(framerSiteUrl).trim() : null;
    const formattedSiteUrlLink = rawSiteUrl
      ? `<a href="${rawSiteUrl.startsWith('http') ? rawSiteUrl : 'https://' + rawSiteUrl}" target="_blank" style="color: #1d4ed8; text-decoration: underline;">${rawSiteUrl}</a>`
      : 'N/A';

    htmlContent = htmlContent
      .replace(/{username}/g, username || 'Customer')
      .replace(/{email}/g, email || '')
      .replace(/{plan}/g, formattedPlan)
      .replace(/{amount}/g, formattedAmount)
      .replace(/{currency}/g, (currency || 'USD').toUpperCase())
      .replace(/{siteId}/g, String(siteId))
      .replace(/{paymentId}/g, String(paymentId))
      .replace(/{couponCode}/g, formattedCoupon)
      .replace(/{framerSiteName}/g, formattedSiteName)
      .replace(/{framerSiteUrl}/g, formattedSiteUrlLink)
      .replace(/{date}/g, formattedDate)
      .replace(/{year}/g, String(new Date().getFullYear()))
      .replace(/src="assets\/Favicon\.png"/g, 'src="cid:framefic-app-logo"')
      .replace(/src="assets\/Framefic\.png"/g, 'src="cid:framefic-logo"');

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: teamRecipient,
      subject: `New Subscription Purchase: ${formattedPlan} by ${username || email} (${formattedAmount})`,
      html: htmlContent,
      attachments: [
        {
          filename: 'Favicon.png',
          path: frameficAppLogoPath,
          cid: 'framefic-app-logo',
        },
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
      ],
    });
    console.log(`📧 Team purchase notification sent to ${teamRecipient} for ${email}`);
  } catch (err) {
    console.error('❌ Failed to send team purchase notification:', err.message);
  }
}

/**
 * Send automatic team notification to hello@framefic.com on recurring subscription renewal payment
 */
export async function sendTeamRecurringPaymentNotification({
  username,
  email,
  plan,
  amount,
  currency = 'USD',
  siteId = 'N/A',
  paymentId = 'N/A',
  subscriptionId = 'N/A',
  nextBillingDate = 'N/A',
  billingReason = 'Subscription Cycle Renewal',
  framerSiteName = null,
  framerSiteUrl = null,
}) {
  try {
    if (isTeamMailBypassed()) {
      console.log(`⏭️ [Team Mail Bypass] Skipped sending recurring payment notification to team for: ${email} (BYPASS_TEAM_MAIL is true)`);
      return;
    }

    if (paymentId && paymentId !== 'N/A') {
      if (sentRecurringNotificationIds.has(paymentId)) {
        console.log(`⏭️  Team recurring payment notification already sent for invoice ${paymentId}, skipping.`);
        return;
      }
      sentRecurringNotificationIds.add(paymentId);
    }

    const normalizedEmail = (email || '').toLowerCase().trim();

    // Auto-lookup site info from DB if missing or N/A
    if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && (normalizedEmail || siteId)) {
      try {
        if (normalizedEmail) {
          const [userRows] = await db.query(
            'SELECT framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
            [normalizedEmail]
          );
          if (userRows && userRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && userRows[0].framer_site_name) {
              framerSiteName = userRows[0].framer_site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && userRows[0].framer_site_url) {
              framerSiteUrl = userRows[0].framer_site_url;
            }
          }
        }
        if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && siteId && siteId !== 'N/A') {
          const [payRows] = await db.query(
            'SELECT site_name, site_url FROM payments WHERE site_id = ? ORDER BY id DESC LIMIT 1',
            [siteId]
          );
          if (payRows && payRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && payRows[0].site_name) {
              framerSiteName = payRows[0].site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && payRows[0].site_url) {
              framerSiteUrl = payRows[0].site_url;
            }
          }
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not lookup user site info for recurring notification:', dbErr.message);
      }
    }

    const teamRecipient = process.env.TEAM_NOTIFICATION_EMAIL || 'hello@framefic.com';
    const templatePath = path.join(__dirname, 'team-recurring-mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    const formattedDate = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' UTC';

    const formattedPlan = (plan || 'subscription').charAt(0).toUpperCase() + (plan || 'subscription').slice(1) + ' Plan';
    const formattedAmount = amount != null ? `$${Number(amount).toFixed(2)}` : 'N/A';

    const formattedSiteName = framerSiteName && String(framerSiteName).trim() ? String(framerSiteName).trim() : 'N/A';
    const rawSiteUrl = framerSiteUrl && String(framerSiteUrl).trim() ? String(framerSiteUrl).trim() : null;
    const formattedSiteUrlLink = rawSiteUrl
      ? `<a href="${rawSiteUrl.startsWith('http') ? rawSiteUrl : 'https://' + rawSiteUrl}" target="_blank" style="color: #1d4ed8; text-decoration: underline;">${rawSiteUrl}</a>`
      : 'N/A';

    htmlContent = htmlContent
      .replace(/{username}/g, username || 'Customer')
      .replace(/{email}/g, email || '')
      .replace(/{plan}/g, formattedPlan)
      .replace(/{amount}/g, formattedAmount)
      .replace(/{currency}/g, (currency || 'USD').toUpperCase())
      .replace(/{siteId}/g, String(siteId))
      .replace(/{subscriptionId}/g, String(subscriptionId))
      .replace(/{paymentId}/g, String(paymentId))
      .replace(/{billingReason}/g, String(billingReason))
      .replace(/{nextBillingDate}/g, String(nextBillingDate))
      .replace(/{framerSiteName}/g, formattedSiteName)
      .replace(/{framerSiteUrl}/g, formattedSiteUrlLink)
      .replace(/{date}/g, formattedDate)
      .replace(/{year}/g, String(new Date().getFullYear()))
      .replace(/src="assets\/Favicon\.png"/g, 'src="cid:framefic-app-logo"')
      .replace(/src="assets\/Framefic\.png"/g, 'src="cid:framefic-logo"');

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: teamRecipient,
      subject: `Recurring Payment Received: ${formattedPlan} by ${username || email} (${formattedAmount})`,
      html: htmlContent,
      attachments: [
        {
          filename: 'Favicon.png',
          path: frameficAppLogoPath,
          cid: 'framefic-app-logo',
        },
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
      ],
    });
    console.log(`📧 Team recurring payment notification sent to ${teamRecipient} for ${email} (Plan: ${formattedPlan}, Amount: ${formattedAmount})`);
  } catch (err) {
    console.error('❌ Failed to send team recurring payment notification:', err.message);
  }
}

/**
 * Send automatic team notification to hello@framefic.com on plan cancellation
 */
export async function sendTeamCancellationNotification({
  username,
  email,
  plan,
  siteId = 'N/A',
  subscriptionId = 'N/A',
  status = 'Scheduled to cancel at end of billing cycle',
  effectiveDate = 'End of current billing period',
  feedback = null,
  framerSiteName = null,
  framerSiteUrl = null,
}) {
  try {
    if (isTeamMailBypassed()) {
      console.log(`⏭️ [Team Mail Bypass] Skipped sending cancellation notification to team for: ${email} (BYPASS_TEAM_MAIL is true)`);
      return;
    }

    if (subscriptionId && subscriptionId !== 'N/A') {
      if (sentCancellationNotificationIds.has(subscriptionId)) {
        console.log(`⏭️  Team cancellation notification already sent for subscription ${subscriptionId}, skipping.`);
        return;
      }
      sentCancellationNotificationIds.add(subscriptionId);
    }

    const normalizedEmail = (email || '').toLowerCase().trim();

    // Auto-lookup site info from DB if missing or N/A
    if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && (normalizedEmail || siteId)) {
      try {
        if (normalizedEmail) {
          const [userRows] = await db.query(
            'SELECT framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
            [normalizedEmail]
          );
          if (userRows && userRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && userRows[0].framer_site_name) {
              framerSiteName = userRows[0].framer_site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && userRows[0].framer_site_url) {
              framerSiteUrl = userRows[0].framer_site_url;
            }
          }
        }
        if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && siteId && siteId !== 'N/A') {
          const [payRows] = await db.query(
            'SELECT site_name, site_url FROM payments WHERE site_id = ? ORDER BY id DESC LIMIT 1',
            [siteId]
          );
          if (payRows && payRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && payRows[0].site_name) {
              framerSiteName = payRows[0].site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && payRows[0].site_url) {
              framerSiteUrl = payRows[0].site_url;
            }
          }
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not lookup user site info for cancellation notification:', dbErr.message);
      }
    }

    const teamRecipient = process.env.TEAM_NOTIFICATION_EMAIL || 'hello@framefic.com';
    const templatePath = path.join(__dirname, 'team-cancel-mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    const formattedDate = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' UTC';

    const formattedPlan = (plan || 'subscription').charAt(0).toUpperCase() + (plan || 'subscription').slice(1) + ' Plan';
    const formattedFeedback = feedback && String(feedback).trim() && String(feedback).trim() !== 'null' && String(feedback).trim() !== 'undefined'
      ? String(feedback).trim()
      : 'None provided';

    const formattedSiteName = framerSiteName && String(framerSiteName).trim() ? String(framerSiteName).trim() : 'N/A';
    const rawSiteUrl = framerSiteUrl && String(framerSiteUrl).trim() ? String(framerSiteUrl).trim() : null;
    const formattedSiteUrlLink = rawSiteUrl
      ? `<a href="${rawSiteUrl.startsWith('http') ? rawSiteUrl : 'https://' + rawSiteUrl}" target="_blank" style="color: #1d4ed8; text-decoration: underline;">${rawSiteUrl}</a>`
      : 'N/A';

    htmlContent = htmlContent
      .replace(/{username}/g, username || 'Customer')
      .replace(/{email}/g, email || '')
      .replace(/{plan}/g, formattedPlan)
      .replace(/{status}/g, status || 'Cancelled')
      .replace(/{effectiveDate}/g, String(effectiveDate || 'End of billing period'))
      .replace(/{feedback}/g, formattedFeedback)
      .replace(/{siteId}/g, String(siteId))
      .replace(/{subscriptionId}/g, String(subscriptionId))
      .replace(/{framerSiteName}/g, formattedSiteName)
      .replace(/{framerSiteUrl}/g, formattedSiteUrlLink)
      .replace(/{date}/g, formattedDate)
      .replace(/{year}/g, String(new Date().getFullYear()))
      .replace(/src="assets\/Favicon\.png"/g, 'src="cid:framefic-app-logo"')
      .replace(/src="assets\/Framefic\.png"/g, 'src="cid:framefic-logo"');

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: teamRecipient,
      subject: `Subscription Cancelled: ${formattedPlan} by ${username || email}`,
      html: htmlContent,
      attachments: [
        {
          filename: 'Favicon.png',
          path: frameficAppLogoPath,
          cid: 'framefic-app-logo',
        },
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
      ],
    });
    console.log(`📧 Team cancellation notification sent to ${teamRecipient} for ${email} (Plan: ${formattedPlan}, Subscription: ${subscriptionId})`);
  } catch (err) {
    console.error('❌ Failed to send team cancellation notification:', err.message);
  }
}

/**
 * Send automatic team notification to hello@framefic.com on payment failure or incomplete payment
 */
export async function sendTeamPaymentFailedNotification({
  username,
  email,
  plan,
  amount,
  currency = 'USD',
  siteId = 'N/A',
  paymentId = 'N/A',
  subscriptionId = 'N/A',
  failureReason = 'Payment transaction failed or card declined',
  status = 'Payment Failed',
  isIncomplete = false,
  framerSiteName = null,
  framerSiteUrl = null,
}) {
  try {
    if (isTeamMailBypassed()) {
      console.log(`⏭️ [Team Mail Bypass] Skipped sending payment failure notification to team for: ${email} (BYPASS_TEAM_MAIL is true)`);
      return;
    }

    if (paymentId && paymentId !== 'N/A') {
      if (sentPaymentFailureNotificationIds.has(paymentId)) {
        console.log(`⏭️  Team payment failure notification already sent for transaction ${paymentId}, skipping.`);
        return;
      }
      sentPaymentFailureNotificationIds.add(paymentId);
    }

    const normalizedEmail = (email || '').toLowerCase().trim();

    // Auto-lookup site info from DB if missing or N/A
    if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && (normalizedEmail || siteId)) {
      try {
        if (normalizedEmail) {
          const [userRows] = await db.query(
            'SELECT framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
            [normalizedEmail]
          );
          if (userRows && userRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && userRows[0].framer_site_name) {
              framerSiteName = userRows[0].framer_site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && userRows[0].framer_site_url) {
              framerSiteUrl = userRows[0].framer_site_url;
            }
          }
        }
        if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && siteId && siteId !== 'N/A') {
          const [payRows] = await db.query(
            'SELECT site_name, site_url FROM payments WHERE site_id = ? ORDER BY id DESC LIMIT 1',
            [siteId]
          );
          if (payRows && payRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && payRows[0].site_name) {
              framerSiteName = payRows[0].site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && payRows[0].site_url) {
              framerSiteUrl = payRows[0].site_url;
            }
          }
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not lookup user site info for payment failure notification:', dbErr.message);
      }
    }

    const teamRecipient = process.env.TEAM_NOTIFICATION_EMAIL || 'hello@framefic.com';
    const templatePath = path.join(__dirname, 'team-payment-failed-mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    const formattedDate = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' UTC';

    const formattedPlan = (plan || 'subscription').charAt(0).toUpperCase() + (plan || 'subscription').slice(1) + ' Plan';
    const formattedAmount = amount != null ? `$${Number(amount).toFixed(2)}` : 'N/A';

    const badgeText = isIncomplete ? 'PAYMENT INCOMPLETE' : 'PAYMENT FAILED';
    const titleText = isIncomplete ? 'Incomplete Payment Alert' : 'Payment Failed Notification';
    const summaryHeader = isIncomplete ? 'INCOMPLETE PAYMENT' : 'PAYMENT ATTEMPT FAILED';
    const subjectPrefix = isIncomplete ? 'Incomplete Payment Alert' : 'Payment Failed';

    const formattedSiteName = framerSiteName && String(framerSiteName).trim() ? String(framerSiteName).trim() : 'N/A';
    const rawSiteUrl = framerSiteUrl && String(framerSiteUrl).trim() ? String(framerSiteUrl).trim() : null;
    const formattedSiteUrlLink = rawSiteUrl
      ? `<a href="${rawSiteUrl.startsWith('http') ? rawSiteUrl : 'https://' + rawSiteUrl}" target="_blank" style="color: #1d4ed8; text-decoration: underline;">${rawSiteUrl}</a>`
      : 'N/A';

    htmlContent = htmlContent
      .replace(/{badgeText}/g, badgeText)
      .replace(/{titleText}/g, titleText)
      .replace(/{summaryHeader}/g, summaryHeader)
      .replace(/{username}/g, username || 'Customer')
      .replace(/{email}/g, email || '')
      .replace(/{plan}/g, formattedPlan)
      .replace(/{amount}/g, formattedAmount)
      .replace(/{currency}/g, (currency || 'USD').toUpperCase())
      .replace(/{siteId}/g, String(siteId))
      .replace(/{subscriptionId}/g, String(subscriptionId))
      .replace(/{paymentId}/g, String(paymentId))
      .replace(/{failureReason}/g, String(failureReason || 'Payment declined or incomplete'))
      .replace(/{status}/g, String(status || 'Failed'))
      .replace(/{framerSiteName}/g, formattedSiteName)
      .replace(/{framerSiteUrl}/g, formattedSiteUrlLink)
      .replace(/{date}/g, formattedDate)
      .replace(/{year}/g, String(new Date().getFullYear()))
      .replace(/src="assets\/Favicon\.png"/g, 'src="cid:framefic-app-logo"')
      .replace(/src="assets\/Framefic\.png"/g, 'src="cid:framefic-logo"');

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: teamRecipient,
      subject: `${subjectPrefix}: ${formattedPlan} for ${username || email} (${formattedAmount})`,
      html: htmlContent,
      attachments: [
        {
          filename: 'Favicon.png',
          path: frameficAppLogoPath,
          cid: 'framefic-app-logo',
        },
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
      ],
    });
    console.log(`📧 Team payment failure notification sent to ${teamRecipient} for ${email} (Plan: ${formattedPlan}, Reason: ${failureReason})`);
  } catch (err) {
    console.error('❌ Failed to send team payment failure notification:', err.message);
  }
}

/**
 * Send automatic team notification to hello@framefic.com when a free trial ends without upgrading
 */
const sentTrialEndedNotificationEmails = new Set();

export async function sendTeamTrialEndedNotification({
  username,
  email,
  siteId = 'N/A',
  trialStart = 'N/A',
  trialEnd = 'N/A',
  componentsAdded = 0,
  framerSiteName = null,
  framerSiteUrl = null,
}) {
  try {
    if (isTeamMailBypassed()) {
      console.log(`⏭️ [Team Mail Bypass] Skipped sending trial ended notification to team for: ${email} (BYPASS_TEAM_MAIL is true)`);
      return;
    }

    const normalizedEmail = (email || '').toLowerCase().trim();
    if (!normalizedEmail) return;

    // Deduplicate so we don't send multiple times for the same site / email trial
    const dedupeKey = `${normalizedEmail}_${siteId || 'site'}`;
    if (sentTrialEndedNotificationEmails.has(dedupeKey)) {
      return;
    }
    sentTrialEndedNotificationEmails.add(dedupeKey);

    // Auto-lookup site info from DB if missing
    if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && (normalizedEmail || siteId)) {
      try {
        if (normalizedEmail) {
          const [userRows] = await db.query(
            'SELECT framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
            [normalizedEmail]
          );
          if (userRows && userRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && userRows[0].framer_site_name) {
              framerSiteName = userRows[0].framer_site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && userRows[0].framer_site_url) {
              framerSiteUrl = userRows[0].framer_site_url;
            }
          }
        }
        if ((!framerSiteName || framerSiteName === 'N/A' || !framerSiteUrl || framerSiteUrl === 'N/A') && siteId && siteId !== 'N/A') {
          const [trialRows] = await db.query(
            'SELECT site_name, site_url FROM reviewfic_trials WHERE site_id = ? ORDER BY id DESC LIMIT 1',
            [siteId]
          );
          if (trialRows && trialRows.length > 0) {
            if ((!framerSiteName || framerSiteName === 'N/A') && trialRows[0].site_name) {
              framerSiteName = trialRows[0].site_name;
            }
            if ((!framerSiteUrl || framerSiteUrl === 'N/A') && trialRows[0].site_url) {
              framerSiteUrl = trialRows[0].site_url;
            }
          }
        }
      } catch (dbErr) {
        console.warn('⚠️ Could not lookup user site info for trial ended notification:', dbErr.message);
      }
    }

    const teamRecipient = process.env.TEAM_NOTIFICATION_EMAIL || 'hello@framefic.com';
    const templatePath = path.join(__dirname, 'team-trial-ended-mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    const formattedDate = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' UTC';

    const formattedSiteName = framerSiteName && String(framerSiteName).trim() ? String(framerSiteName).trim() : 'N/A';
    const rawSiteUrl = framerSiteUrl && String(framerSiteUrl).trim() ? String(framerSiteUrl).trim() : null;
    const formattedSiteUrlLink = rawSiteUrl
      ? `<a href="${rawSiteUrl.startsWith('http') ? rawSiteUrl : 'https://' + rawSiteUrl}" target="_blank" style="color: #1d4ed8; text-decoration: underline;">${rawSiteUrl}</a>`
      : 'N/A';

    htmlContent = htmlContent
      .replace(/{username}/g, username || email?.split('@')[0] || 'Customer')
      .replace(/{email}/g, email || '')
      .replace(/{siteId}/g, String(siteId || 'N/A'))
      .replace(/{trialStart}/g, String(trialStart || 'N/A'))
      .replace(/{trialEnd}/g, String(trialEnd || 'N/A'))
      .replace(/{componentsAdded}/g, String(componentsAdded || 0))
      .replace(/{framerSiteName}/g, formattedSiteName)
      .replace(/{framerSiteUrl}/g, formattedSiteUrlLink)
      .replace(/{date}/g, formattedDate)
      .replace(/{year}/g, String(new Date().getFullYear()))
      .replace(/src="assets\/Favicon\.png"/g, 'src="cid:framefic-app-logo"')
      .replace(/src="assets\/Framefic\.png"/g, 'src="cid:framefic-logo"');

    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: teamRecipient,
      subject: `Free Trial Ended: ${username || email}`,
      html: htmlContent,
      attachments: [
        {
          filename: 'Favicon.png',
          path: frameficAppLogoPath,
          cid: 'framefic-app-logo',
        },
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
      ],
    });
    console.log(`📧 Team trial ended notification sent to ${teamRecipient} for ${email}`);
  } catch (err) {
    console.error('❌ Failed to send team trial ended notification:', err.message);
  }
}

/**
 * Automatically inspect expired free trials in `reviewfic_trials`, update status,
 * send team notification, and dispatch to CRMfic.
 */
export async function checkAndExpireTrials() {
  try {
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Find trials where trial has ended and current_plan_status is still 'trialing'
    const [expiredTrials] = await db.query(
      `SELECT t.id, t.email, t.site_id, t.site_name, t.site_url, t.trial_start, t.trial_end, t.components_added, u.username
       FROM reviewfic_trials t
       LEFT JOIN \`reviewfic-userlogin\` u ON (t.email = u.email)
       WHERE t.trial_end <= ?
         AND (t.current_plan_status = 'trialing' OR t.current_plan_status IS NULL)
       LIMIT 50`,
      [nowStr]
    );

    if (!expiredTrials || expiredTrials.length === 0) return 0;

    let expiredCount = 0;
    for (const trial of expiredTrials) {
      // Verify if user already upgraded / paid
      const [paid] = await db.query(
        `SELECT id FROM payments 
         WHERE (email = ? OR site_id = ?) 
           AND status IN ('active', 'paid', 'completed', 'succeeded') 
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`,
        [trial.email, trial.site_id, nowStr]
      );

      if (paid && paid.length > 0) {
        // User has paid, update trial status to active/paid
        await db.query(`UPDATE reviewfic_trials SET current_plan_status = 'paid' WHERE id = ?`, [trial.id]);
        continue;
      }

      // Mark trial as expired
      await db.query(`UPDATE reviewfic_trials SET current_plan_status = 'expired' WHERE id = ?`, [trial.id]);

      const customerEmail = (trial.email || '').toLowerCase().trim();
      const username = trial.username || customerEmail.split('@')[0] || 'Customer';

      // 1. Trigger the order / lifecycle important event (team notification)
      sendTeamTrialEndedNotification({
        username,
        email: customerEmail,
        siteId: trial.site_id,
        trialStart: trial.trial_start,
        trialEnd: trial.trial_end,
        componentsAdded: trial.components_added || 0,
        framerSiteName: trial.site_name,
        framerSiteUrl: trial.site_url,
      }).catch(err => console.warn('⚠️ Error sending trial ended team notification:', err.message));

      // 2. Dispatch to CRMfic and FluentCRM with short and meaningful tags & list
      forwardToCRMfic({
        email: customerEmail,
        username,
        status: 'Subscribed',
        list: ['App Users', 'Reviewfic'],
        tags: ['Reviewfic-Expired', 'Reviewfic'],
        paymentStatus: 'expired',
        siteName: trial.site_name,
        siteUrl: trial.site_url,
        event: 'trial_ended',
      }).catch(err => console.warn('⚠️ CRMfic trial ended webhook sync error:', err.message));

      forwardToFluentCRM({
        email: customerEmail,
        username,
        status: 'subscribed',
        list: ['App Users', 'Reviewfic'],
        tags: ['Reviewfic-Expired', 'Reviewfic'],
        paymentStatus: 'expired',
        siteName: trial.site_name,
        siteUrl: trial.site_url,
        event: 'trial_ended',
      }).catch(err => console.warn('⚠️ FluentCRM trial ended webhook sync error:', err.message));

      expiredCount++;
    }

    if (expiredCount > 0) {
      console.log(`⏳ [Trial Expiration Monitor] Processed and synced ${expiredCount} expired trial(s).`);
    }

    return expiredCount;
  } catch (err) {
    console.error('⚠️ Error in checkAndExpireTrials:', err.message);
    return 0;
  }
}

// Map: normalizedEmail → { code, expiresAt }
// resetCodeStore imported from auth.js

function generateResetCode() {
  return generateOtpCode();
}

// ────────────────────────────────────────────────────────────
//  POST /api/auth/forgot-password
//  Send a 6-digit reset code to the user's email.
// ────────────────────────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    // Check account exists
    const [rows] = await db.query(
      'SELECT id, username FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No account found with that email. Please sign up.' });
    }

    const rawUsername = rows[0]?.username;
    const userName = typeof rawUsername === 'string' && rawUsername.trim()
      ? rawUsername.trim()
      : 'there';
    const code = generateResetCode();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
    resetCodeStore.set(email, { code, expiresAt });

    const templatePath = path.join(__dirname, 'mail.html');
    let htmlContent = await fs.readFile(templatePath, 'utf-8');

    htmlContent = htmlContent
      .replace('{title}', 'Reset Password')
      .replace('{header_title}', 'Reset your password')
      .replace('{header_subtitle}', 'Verify your identity to continue')
      .replace('{body_text}', 'Use the code below to reset your <strong style="color: #8aa2ff; font-weight: 700;">Framefic</strong> account password. This code expires in <strong style="color: #8aa2ff; font-weight: 700;">15 minutes</strong>')
      .replace('{username}', userName)
      .replace('{code}', code)
      .replace(/{year}/g, String(new Date().getFullYear()));

    // Use object syntax for 'from' to strictly guarantee valid MAIL FROM envelope
    await smtpTransporter.sendMail({
      from: {
        name: 'Framefic',
        address: getCleanFromAddress()
      },
      to: email,
      subject: 'Your Framefic Password Reset Code',
      html: htmlContent,
      attachments: [
        {
          filename: 'Framefic.png',
          path: frameficLogoPath,
          cid: 'framefic-logo',
        },
        {
          filename: 'wave.png',
          path: waveImagePath,
          cid: 'wave-image',
        },

      ],
    });

    console.log(`📧 Reset code sent to ${email}`);
    return res.json({ success: true, message: 'If that email exists, a code has been sent.' });
  } catch (err) {
    console.error('❌ Error sending reset code:', err);
    return res.status(500).json({ message: 'Failed to send reset code. Please try again.' });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/verify-reset-code
//  Verify the 6-digit code without resetting password yet.
// ────────────────────────────────────────────────────────────
app.post('/api/auth/verify-reset-code', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const rawCode = req.body.code;
    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and code are required.' });
    }

    const entry = resetCodeStore.get(email);
    if (!entry) {
      return res.status(400).json({ message: 'No reset code found. Please request a new one.' });
    }
    if (Date.now() > entry.expiresAt) {
      resetCodeStore.delete(email);
      return res.status(400).json({ message: 'Reset code has expired. Please request a new one.' });
    }
    if (entry.code !== code) {
      return res.status(400).json({ message: 'Incorrect reset code. Please try again.' });
    }

    // Mark code as verified (keep it for the reset step)
    entry.verified = true;
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Error verifying reset code:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/reset-password
//  Reset the user's password after code verification.
// ────────────────────────────────────────────────────────────
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const rawCode = req.body.code;
    const { newPassword } = req.body;
    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code, and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const entry = resetCodeStore.get(email);
    if (!entry || !entry.verified) {
      return res.status(400).json({ message: 'Code not verified. Please complete the verification step.' });
    }
    if (Date.now() > entry.expiresAt) {
      resetCodeStore.delete(email);
      return res.status(400).json({ message: 'Reset session expired. Please start over.' });
    }
    if (entry.code !== code) {
      return res.status(400).json({ message: 'Invalid code.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    const [result] = await db.query(
      'UPDATE `reviewfic-userlogin` SET password = ? WHERE email = ?',
      [passwordHash, email]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    resetCodeStore.delete(email);
    console.log(`🔑 Password reset successfully for ${email}`);
    return res.json({ success: true, message: 'Password reset successfully.' });
  } catch (err) {
    console.error('❌ Error resetting password:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/webhook/fluentcrm
//  Frontend proxy to avoid CORS when talking to FluentCRM
// ────────────────────────────────────────────────────────────
app.post('/api/webhook/fluentcrm', async (req, res) => {
  const url = process.env.FLUENTCRM_WEBHOOK_URL || '';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const text = await response.text();
    let result = {};
    try {
      result = JSON.parse(text);
    } catch (e) {
      result = { message: text };
    }

    if (!response.ok) {
      throw new Error(`FluentCRM responded with ${response.status}: ${text}`);
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error('⚠️  Frontend FluentCRM webhook forward failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/webhook/google-signup
//  Direct endpoint to trigger Google sign-up webhook
// ────────────────────────────────────────────────────────────
app.post('/api/webhook/google-signup', async (req, res) => {
  try {
    const { email, username, googleId, avatarUrl } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    await sendSocialSignupWebhook({
      email,
      username: username || email.split('@')[0],
      googleId: googleId || 'google_user',
      avatarUrl: avatarUrl || null,
    });

    sendTeamSignupNotification({
      username: username || email.split('@')[0],
      email,
      source: 'Google Sign-up',
    }).catch(err => console.error('⚠️ Team signup notification error:', err.message));

    res.json({ success: true, message: 'Google signup webhook event triggered successfully.' });
  } catch (err) {
    console.error('❌ Error in /api/webhook/google-signup:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/webhook/fluentcrm
//  Dedicated endpoint to trigger or test FluentCRM Webhook
// ────────────────────────────────────────────────────────────
app.post('/api/webhook/fluentcrm', async (req, res) => {
  try {
    const { email, username, firstName, lastName, phone, status, list, tags, plan, event, siteName, siteUrl } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const success = await forwardToFluentCRM({
      email,
      username,
      firstName,
      lastName,
      phone,
      status: status || 'subscribed',
      list: list || ['App Users', 'Reviewfic'],
      tags: tags || ['Reviewfic', 'Reviewfic-Status-Trialing'],
      plan: plan || null,
      siteName: siteName || null,
      siteUrl: siteUrl || null,
      event: event || 'manual_trigger',
    });

    res.json({
      success,
      message: success ? 'FluentCRM webhook event dispatched successfully.' : 'Failed to dispatch FluentCRM webhook event.',
    });
  } catch (err) {
    console.error('❌ Error in /api/webhook/fluentcrm:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/webhook/crmfic
//  Dedicated endpoint to trigger or test CRMfic Webhook
// ────────────────────────────────────────────────────────────
app.post('/api/webhook/crmfic', async (req, res) => {
  try {
    const { email, username, firstName, lastName, phone, status, list, tags, plan, event, siteName, siteUrl } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const success = await forwardToCRMfic({
      email,
      username,
      firstName,
      lastName,
      phone,
      status: status || 'Subscribed',
      list: list || ['App Users', 'Reviewfic'],
      tags: tags || ['Reviewfic', 'Reviewfic-Status-Trialing'],
      plan: plan || null,
      siteName: siteName || null,
      siteUrl: siteUrl || null,
      event: event || 'manual_trigger',
    });

    res.json({
      success,
      message: success ? 'CRMfic webhook event dispatched successfully.' : 'Failed to dispatch CRMfic webhook event.',
    });
  } catch (err) {
    console.error('❌ Error in /api/webhook/crmfic:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/test/trigger-lifecycle-event
//  Trigger and test any of the 4 important lifecycle events:
//  - 'trial_ended'
//  - 'recurring_payment'
//  - 'plan_canceled'
//  - 'payment_failed'
// ────────────────────────────────────────────────────────────
app.post('/api/test/trigger-lifecycle-event', async (req, res) => {
  try {
    const {
      eventType = 'trial_ended', // 'trial_ended' | 'recurring_payment' | 'plan_canceled' | 'payment_failed'
      email = 'test@example.com',
      username = 'Test User',
      plan = 'monthly',
      amount = 9.99,
      currency = 'USD',
      siteId = 'site_test_123',
      siteName = 'My Framer Site',
      siteUrl = 'https://mysite.framer.website',
      failureReason = 'Card declined: insufficient funds',
      cancellationReason = 'Too expensive for our current stage',
      sendEmail = true,
    } = req.body || {};

    const cleanPlan = (plan || 'monthly').replace(/^plan[-_]?/i, '').replace(/^reviewfic[-_]?/i, '');
    const formattedPlan = cleanPlan.charAt(0).toUpperCase() + cleanPlan.slice(1);

    let assignedTag = 'Trial Users';
    const assignedList = ['App Users', 'Reviewfic'];
    let tagsList = ['Trial Users'];
    let paymentStatus = 'trialing';

    switch (eventType) {
      case 'trial_ended':
      case 'trial_expired': {
        assignedTag = 'Expired Users';
        tagsList = ['Expired Users'];
        paymentStatus = 'expired';

        if (sendEmail) {
          sendTeamTrialEndedNotification({
            username,
            email,
            siteId,
            trialStart: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
            trialEnd: new Date().toISOString().slice(0, 10),
            componentsAdded: 3,
            framerSiteName: siteName,
            framerSiteUrl: siteUrl,
          }).catch(err => console.warn('⚠️ Test trial ended email error:', err.message));
        }
        break;
      }

      case 'recurring_payment':
      case 'recurring_success': {
        assignedTag = 'Paid Users';
        tagsList = ['Paid Users'];
        paymentStatus = 'paid';

        if (sendEmail) {
          sendTeamRecurringPaymentNotification({
            username,
            email,
            plan: cleanPlan,
            amount,
            currency,
            siteId,
            paymentId: 'in_test_recurring_' + Date.now(),
            subscriptionId: 'sub_test_' + Date.now(),
            nextBillingDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
            billingReason: 'Subscription Cycle Renewal',
            framerSiteName: siteName,
            framerSiteUrl: siteUrl,
          }).catch(err => console.warn('⚠️ Test recurring email error:', err.message));
        }
        break;
      }

      case 'plan_canceled':
      case 'cancellation': {
        assignedTag = 'Cancelled Users';
        tagsList = ['Cancelled Users'];
        paymentStatus = 'cancelled';

        if (sendEmail) {
          sendTeamCancellationNotification({
            username,
            email,
            plan: cleanPlan,
            siteId,
            subscriptionId: 'sub_test_' + Date.now(),
            status: 'Scheduled to cancel at end of billing cycle',
            effectiveDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            feedback: cancellationReason,
            framerSiteName: siteName,
            framerSiteUrl: siteUrl,
          }).catch(err => console.warn('⚠️ Test cancel email error:', err.message));
        }
        break;
      }

      case 'payment_failed':
      case 'failed': {
        assignedTag = 'Failed Users';
        tagsList = ['Failed Users'];
        paymentStatus = 'failed';

        if (sendEmail) {
          sendTeamPaymentFailedNotification({
            username,
            email,
            plan: cleanPlan,
            amount,
            currency,
            siteId,
            paymentId: 'pi_test_failed_' + Date.now(),
            subscriptionId: 'sub_test_' + Date.now(),
            failureReason,
            status: 'Past Due (Attempt #1)',
            framerSiteName: siteName,
            framerSiteUrl: siteUrl,
          }).catch(err => console.warn('⚠️ Test payment failed email error:', err.message));
        }
        break;
      }

      default:
        return res.status(400).json({
          success: false,
          message: `Unknown eventType: ${eventType}. Allowed types: 'trial_ended', 'recurring_payment', 'plan_canceled', 'payment_failed'`,
        });
    }

    // Dispatch to CRMfic and FluentCRM
    const [crmficRes, fluentRes] = await Promise.allSettled([
      forwardToCRMfic({
        email,
        username,
        status: 'Subscribed',
        list: assignedList,
        tags: tagsList,
        plan: cleanPlan,
        paymentStatus,
        siteName,
        siteUrl,
        event: eventType,
        amount,
        currency,
        failureReason: eventType === 'payment_failed' ? failureReason : null,
        cancellationReason: eventType === 'plan_canceled' ? cancellationReason : null,
      }),
      forwardToFluentCRM({
        email,
        username,
        status: 'subscribed',
        list: assignedList,
        tags: tagsList,
        plan: cleanPlan,
        paymentStatus,
        siteName,
        siteUrl,
        event: eventType,
        amount,
        currency,
        failureReason: eventType === 'payment_failed' ? failureReason : null,
        cancellationReason: eventType === 'plan_canceled' ? cancellationReason : null,
      }),
    ]);

    const crmficSuccess = crmficRes.status === 'fulfilled' && crmficRes.value;
    const fluentSuccess = fluentRes.status === 'fulfilled' && fluentRes.value;

    return res.json({
      success: true,
      eventType,
      assignedTag,
      assignedList,
      tagsSent: tagsList,
      dispatched: {
        crmfic: crmficSuccess,
        fluentcrm: fluentSuccess,
        teamEmailSent: sendEmail,
      },
      message: `Triggered '${eventType}' successfully. CRMfic Tag: '${assignedTag}', List: '${assignedList}'.`,
    });
  } catch (err) {
    console.error('❌ Error in /api/test/trigger-lifecycle-event:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  CRMfic & MailerPress Admin Reconciliation & Sync Endpoints
// ────────────────────────────────────────────────────────────

// 1. GET /api/admin/crmfic/stats (Inspect CRMfic sync metrics)
app.get('/api/admin/crmfic/stats', async (req, res) => {
  try {
    const stats = await getCRMficSyncStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    console.error('❌ Error in /api/admin/crmfic/stats:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/admin/crmfic/missed-contacts (View all unsynced contacts)
app.get('/api/admin/crmfic/missed-contacts', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    const missed = await getMissedCRMficContacts(limit);
    res.json({
      success: true,
      totalMissed: missed.length,
      missedContacts: missed,
    });
  } catch (err) {
    console.error('❌ Error in /api/admin/crmfic/missed-contacts:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/admin/crmfic/sync-missed (Reconcile & sync only missed/unsynced contacts)
app.post('/api/admin/crmfic/sync-missed', async (req, res) => {
  try {
    const limit = req.body?.limit ? parseInt(req.body.limit, 10) : 100;
    const result = await autoSyncMissedContactsToCRMfic({ limit, forceAll: false });
    res.json({
      success: !result.error && !result.skipped,
      ...result,
      message: result.skipped
        ? 'Reconciliation already in progress.'
        : `Reconciliation complete: ${result.syncedCount || 0} of ${result.totalFound || 0} missed contacts synced to CRMfic.`,
    });
  } catch (err) {
    console.error('❌ Error in /api/admin/crmfic/sync-missed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/admin/crmfic/sync-all (Full sync of all database contacts to CRMfic)
app.post('/api/admin/crmfic/sync-all', async (req, res) => {
  try {
    const limit = req.body?.limit ? parseInt(req.body.limit, 10) : 500;
    const result = await autoSyncMissedContactsToCRMfic({ limit, forceAll: true });
    res.json({
      success: !result.error && !result.skipped,
      ...result,
      message: result.skipped
        ? 'Reconciliation already in progress.'
        : `Full CRMfic sync complete: ${result.syncedCount || 0} of ${result.totalFound || 0} contacts synced to CRMfic.`,
    });
  } catch (err) {
    console.error('❌ Error in /api/admin/crmfic/sync-all:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST /api/admin/sync-crmfic-users (Alias for bulk CRMfic sync)
app.post('/api/admin/sync-crmfic-users', async (req, res) => {
  try {
    const limit = req.body?.limit ? parseInt(req.body.limit, 10) : 500;
    const result = await autoSyncMissedContactsToCRMfic({ limit, forceAll: true });

    res.json({
      success: !result.error && !result.skipped,
      message: result.skipped
        ? 'Sync already in progress.'
        : `Bulk CRMfic sync completed. ${result.syncedCount || 0} users synced successfully, ${result.failedCount || 0} failed.`,
      totalUsers: result.totalFound || 0,
      syncedCount: result.syncedCount || 0,
      failedCount: result.failedCount || 0,
    });
  } catch (err) {
    console.error('❌ Error in /api/admin/sync-crmfic-users:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST /api/admin/sync-fluentcrm-users & sync-mailerpress-users
const handleSyncMailerpressUsers = async (req, res) => {
  try {
    const allContacts = await getAllDBContacts({ unsyncedOnly: false });

    let syncedCount = 0;
    let failedCount = 0;

    for (const c of allContacts) {
      if (!c.email) continue;
      try {
        const ok = await syncUserToFluentCRM(c.email, 'admin_bulk_sync');
        if (ok) syncedCount++;
        else failedCount++;
      } catch (e) {
        failedCount++;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    res.json({
      success: true,
      message: `Bulk MailerPress/FluentCRM sync completed. ${syncedCount} users synced successfully, ${failedCount} failed.`,
      totalUsers: allContacts.length,
      syncedCount,
      failedCount,
    });
  } catch (err) {
    console.error('❌ Error in /api/admin/sync-fluentcrm-users:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
app.post('/api/admin/sync-fluentcrm-users', handleSyncMailerpressUsers);
app.post('/api/admin/sync-mailerpress-users', handleSyncMailerpressUsers);

// 7. POST /api/admin/sync-crm-users & /api/admin/sync-all-crm-users
const handleSyncAllCRMUsers = async (req, res) => {
  try {
    const allContacts = await getAllDBContacts({ unsyncedOnly: false });

    let syncedCount = 0;
    let failedCount = 0;

    for (const c of allContacts) {
      if (!c.email) continue;
      try {
        const resObj = await syncUserToAllCRMs(c.email, 'admin_bulk_sync');
        if (resObj.crmfic || resObj.fluentcrm) syncedCount++;
        else failedCount++;
      } catch (e) {
        failedCount++;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    res.json({
      success: true,
      message: `Bulk CRM sync completed. Processed ${allContacts.length} unified contacts.`,
      totalUsers: allContacts.length,
      syncedCount,
      failedCount,
    });
  } catch (err) {
    console.error('❌ Error in bulk sync all CRMs:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
app.post('/api/admin/sync-crm-users', handleSyncAllCRMUsers);
app.post('/api/admin/sync-all-crm-users', handleSyncAllCRMUsers);
app.post('/api/admin/sync-users-to-webhook', handleSyncAllCRMUsers);
app.post('/admin/sync-users-to-webhook', handleSyncAllCRMUsers);

// ────────────────────────────────────────────────────────────
//  POST /api/create-payment-intent
//  The Framer plugin calls this to start a checkout.
// ────────────────────────────────────────────────────────────
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { plan, siteId, framerUserId, email, userName, userEmail } = req.body;
    const resolvedEmail = normalizeEmail(email || userEmail);
    const userLogin = await getUserLoginByEmail(resolvedEmail);
    const resolvedUserName = userLogin?.username || userName || null;
    const planConfig = getPlanConfig(plan);

    if (!plan || !siteId) {
      return res.status(400).json({ message: 'Missing required fields: plan, siteId' });
    }
    if (!planConfig) {
      return res.status(400).json({ message: `Invalid plan: ${plan}` });
    }

    if (!stripe) {
      return res.status(503).json({
        message: 'Stripe is not configured. Please set valid Stripe sandbox API credentials in your .env file.',
      });
    }

    // ── Lifetime deal cap check ──
    if (plan === 'lifetime') {
      const maxLifetime = parseInt(process.env.LIFETIME_DEAL_MAX_USERS || '20', 10);
      const [rows] = await db.query(
        "SELECT COUNT(*) as count FROM payments WHERE plan = 'lifetime' AND status = 'paid'"
      );
      if (rows[0].count >= maxLifetime) {
        return res.status(403).json({
          message: `The lifetime deal is sold out! Only ${maxLifetime} spots were available.`,
          sold_out: true,
        });
      }
    }

    // ── Map plan → Stripe Price ID ──
    const priceMap = getPriceMap();
    const priceId = priceMap[plan];

    // ── Handle Lifetime (One-time PaymentIntent) ──
    // Product-linking happens post-payment in /api/verify-payment
    if (plan === 'lifetime') {
      if (!priceId) {
        return res.status(500).json({ message: 'Stripe price is not configured for the lifetime plan (STRIPE_PRICE_LIFETIME).' });
      }

      const customerId = await findOrCreateStripeCustomer(siteId, resolvedEmail, resolvedUserName, framerUserId);

      // Retrieve the configured price so the amount matches the Stripe dashboard exactly
      let lifetimeAmount = toMinorUnits(planConfig.amount);
      let lifetimeCurrency = planConfig.currency;
      try {
        const stripePrice = await stripe.prices.retrieve(priceId);
        if (stripePrice.unit_amount) lifetimeAmount = stripePrice.unit_amount;
        if (stripePrice.currency) lifetimeCurrency = stripePrice.currency;
      } catch (e) {
        console.warn('⚠️  Could not retrieve lifetime price from Stripe, using config amount:', e.message);
      }

      // ── Apply Proration Discount for Unused Subscription Time ──
      let prorationDiscount = 0;
      let prorationMsg = '';
      try {
        const record = await getLatestRecurringSubscriptionRecord(siteId);
        if (record && record.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(record.status)) {
          const activeSub = await stripe.subscriptions.retrieve(record.stripe_subscription_id);
          const now = Math.floor(Date.now() / 1000);
          const start = activeSub.current_period_start;
          const end = activeSub.current_period_end;
          const amountPaid = activeSub.plan?.amount || activeSub.items?.data?.[0]?.plan?.amount || 0;

          if (now >= start && now < end && amountPaid > 0) {
            const totalSeconds = end - start;
            const remainingSeconds = end - now;
            prorationDiscount = Math.floor(amountPaid * (remainingSeconds / totalSeconds));

            if (prorationDiscount > 0) {
              prorationMsg = ` (Prorated: -$${(prorationDiscount / 100).toFixed(2)})`;
              lifetimeAmount = Math.max(50, lifetimeAmount - prorationDiscount); // minimum 50 cents
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ Could not calculate proration for lifetime deal:', e.message);
      }

      const paymentIntent = await stripe.paymentIntents.create({
        customer: customerId,
        amount: lifetimeAmount,
        currency: lifetimeCurrency,
        payment_method_types: ['card'],
        setup_future_usage: 'off_session', // saves card as primary payment method
        description: `Reviewfic – Lifetime Deal${prorationMsg}`,
        metadata: {
          plan_type: plan,
          price_id: priceId,
          framer_site_id: siteId,
          framer_user_id: framerUserId || '',
          framer_user_name: resolvedUserName || '',
          framer_user_email: resolvedEmail || '',
          proration_discount: prorationDiscount.toString(),
        },
        receipt_email: resolvedEmail || undefined,
      });

      return res.json({
        clientSecret: paymentIntent.client_secret,
        mode: 'payment',
        prorationApplied: prorationDiscount > 0,
        originalAmount: toMinorUnits(planConfig.amount),
        finalAmount: lifetimeAmount,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null
      });
    }

    // ── Handle Recurring (Subscription) ──
    if (!priceId) {
      return res.status(500).json({ message: `Stripe price is not configured for plan: ${plan}` });
    }
    const customerId = await findOrCreateStripeCustomer(siteId, resolvedEmail, resolvedUserName, framerUserId);

    // ── Coupon code support (monthly plan only) ──
    const { couponCode } = req.body;
    let resolvedPromotionCode = null;
    if (couponCode && plan === 'monthly') {
      try {
        // Look up the promotion code by its user-facing code string
        const promos = await stripe.promotionCodes.list({
          code: couponCode,
          active: true,
          limit: 1,
        });
        if (promos.data.length === 0) {
          return res.status(400).json({ message: `Invalid or expired coupon code: ${couponCode}` });
        }
        const promo = promos.data[0];
        const coupon = promo.promotion?.coupon || promo.coupon;
        const couponId = typeof coupon === 'string' ? coupon : coupon?.id;
        if (!couponId) {
          return res.status(400).json({ message: `Invalid or expired coupon code: ${couponCode}` });
        }
        // Extract the underlying coupon ID to bypass strict promotion code rules (e.g. first-time user)
        resolvedPromotionCode = couponId;
      } catch (e) {
        console.warn('⚠️ Error validating coupon code:', e.message);
        return res.status(400).json({ message: `Invalid coupon code: ${couponCode}` });
      }
    }

    const subscriptionParams = {
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription', // saves card as primary payment method
        payment_method_types: ['card'],
      },
      expand: ['latest_invoice.payment_intent', 'latest_invoice.confirmation_secret', 'pending_setup_intent'],
      metadata: {
        plan_type: plan,
        framer_site_id: siteId,
        framer_user_id: framerUserId || '',
        framer_user_name: resolvedUserName || '',
        framer_user_email: resolvedEmail || '',
      },
    };

    // Apply the promotion code if provided and validated
    if (resolvedPromotionCode) {
      subscriptionParams.discounts = [{ coupon: resolvedPromotionCode }];
    }

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    // Pre-insert pending payment record with coupon code if applied
    try {
      const expiresAt =
        unixToMySQLDateTime(subscription.current_period_end) ||
        unixToMySQLDateTime(subscription.items?.data?.[0]?.current_period_end);

      await db.query(
        `INSERT INTO payments (
          user_login_id,
          username,
          site_id,
          plan,
          email,
          stripe_customer_id,
          stripe_subscription_id,
          amount,
          currency,
          status,
          expires_at,
          coupon_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          coupon_code = COALESCE(VALUES(coupon_code), coupon_code),
          status = COALESCE(status, 'pending')`,
        [
          userLogin?.id || null,
          resolvedUserName,
          siteId,
          plan,
          resolvedEmail,
          customerId,
          subscription.id,
          null,
          subscription.currency || 'usd',
          'pending',
          expiresAt,
          couponCode || null
        ]
      );
    } catch (dbErr) {
      console.warn('⚠️ Error inserting pending payment record in create-payment-intent:', dbErr.message);
    }

    let clientSecret =
      subscription.latest_invoice?.payment_intent?.client_secret ||
      subscription.latest_invoice?.confirmation_secret?.client_secret ||
      subscription.pending_setup_intent?.client_secret;

    if (!clientSecret && subscription.latest_invoice?.id) {
      clientSecret = await getInvoiceClientSecret(subscription.latest_invoice.id);
    }

    if (!clientSecret && subscription.status !== 'active' && subscription.status !== 'trialing') {
      console.error('Subscription created but missing client secret. Subscription data:', JSON.stringify(subscription, null, 2));
      throw new Error('No client secret returned for subscription payment');
    }

    return res.json({
      clientSecret,
      subscriptionId: subscription.id,
      mode: 'subscription',
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null
    });
  } catch (err) {
    console.error('❌ Error creating payment:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/payment-config
//  Retrieves the Stripe publishable key dynamically
// ────────────────────────────────────────────────────────────
app.get('/api/payment-config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null
  });
});

// ────────────────────────────────────────────────────────────
//  POST /api/apply-coupon
//  Applies a Stripe promotion code to an existing incomplete subscription
// ────────────────────────────────────────────────────────────
app.post('/api/apply-coupon', async (req, res) => {
  try {
    const { subscriptionId, couponCode } = req.body;
    if (!subscriptionId || !couponCode) {
      return res.status(400).json({ message: 'Missing subscriptionId or couponCode' });
    }

    // Look up the promotion code by its user-facing code string
    const promos = await stripe.promotionCodes.list({
      code: couponCode,
      active: true,
      limit: 1,
    });

    if (promos.data.length === 0) {
      return res.status(400).json({ message: `Invalid or expired coupon code: ${couponCode}` });
    }

    const promo = promos.data[0];
    const coupon = promo.promotion?.coupon || promo.coupon;
    const couponId = typeof coupon === 'string' ? coupon : coupon?.id;
    if (!couponId) {
      return res.status(400).json({ message: `Invalid or expired coupon code: ${couponCode}` });
    }

    // 1. Retrieve the existing incomplete subscription to get customer, price, and metadata
    const oldSubscription = await stripe.subscriptions.retrieve(subscriptionId);

    let subscription = oldSubscription;
    let finalSubscriptionId = subscriptionId;

    if (oldSubscription.status === 'incomplete') {
      const customerId = oldSubscription.customer;
      const priceId = oldSubscription.items.data[0].price.id;
      const metadata = oldSubscription.metadata;

      // Cancel the old subscription
      try {
        await stripe.subscriptions.cancel(subscriptionId);
      } catch (cancelErr) {
        console.warn('⚠️ Error cancelling old subscription:', cancelErr.message);
      }

      // Create new subscription with the coupon applied from the start
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        discounts: [{ coupon: couponId }],
        expand: ['latest_invoice.payment_intent', 'latest_invoice.confirmation_secret', 'pending_setup_intent'],
        metadata: metadata,
      });
      finalSubscriptionId = subscription.id;

      // Update the payment record with the new subscription ID and coupon code
      try {
        await db.query(
          `UPDATE payments
           SET stripe_subscription_id = ?, coupon_code = ?
           WHERE stripe_subscription_id = ?`,
          [finalSubscriptionId, couponCode, subscriptionId]
        );
      } catch (dbErr) {
        console.warn('⚠️ Error updating database record for subscription switch:', dbErr.message);
      }
    } else {
      // If it's already active, just apply it
      subscription = await stripe.subscriptions.update(
        subscriptionId,
        {
          discounts: [{ coupon: couponId }],
          expand: ['latest_invoice.payment_intent'],
        }
      );

      try {
        await db.query(
          `UPDATE payments
           SET coupon_code = ?
           WHERE stripe_subscription_id = ?`,
          [couponCode, subscriptionId]
        );
      } catch (e) {
        console.warn('⚠️ Error updating coupon_code in apply-coupon:', e.message);
      }
    }

    let clientSecret = null;
    let latestInvoiceId = null;
    let totalAmount = null;

    if (subscription.latest_invoice) {
      if (typeof subscription.latest_invoice === 'string') {
        latestInvoiceId = subscription.latest_invoice;
      } else {
        latestInvoiceId = subscription.latest_invoice.id;
        totalAmount = subscription.latest_invoice.total;
        clientSecret =
          subscription.latest_invoice.payment_intent?.client_secret ||
          subscription.latest_invoice.confirmation_secret?.client_secret ||
          subscription.pending_setup_intent?.client_secret;
      }
    }

    if (!clientSecret && latestInvoiceId) {
      try {
        const expandedInvoice = await stripe.invoices.retrieve(latestInvoiceId, {
          expand: ['payment_intent', 'confirmation_secret'],
        });
        clientSecret =
          expandedInvoice.payment_intent?.client_secret ||
          expandedInvoice.confirmation_secret?.client_secret;
        if (totalAmount === null) {
          totalAmount = expandedInvoice.total;
        }
      } catch (e) {
        console.warn('⚠️ Error retrieving latest invoice:', e.message);
      }
    }

    const isFree = totalAmount === 0 || subscription.status === 'active' || subscription.status === 'trialing';

    // If subscription is now active or trialing (e.g. because coupon made it free/100% off),
    // we should sync the DB immediately to mark it paid.
    if (isFree) {
      try {
        const status = subscription.status === 'incomplete' && totalAmount === 0 ? 'active' : subscription.status;
        const expiresAt =
          unixToMySQLDateTime(subscription.current_period_end) ||
          unixToMySQLDateTime(subscription.items?.data?.[0]?.current_period_end);

        // Update the payments record with active status and coupon code
        await db.query(
          `UPDATE payments
           SET status = ?, expires_at = ?, amount = COALESCE(?, amount), currency = COALESCE(?, currency), coupon_code = COALESCE(?, coupon_code)
           WHERE stripe_subscription_id = ?`,
          [status, expiresAt, totalAmount !== null ? toMajorUnits(totalAmount) : 0.00, subscription.currency || 'usd', couponCode, finalSubscriptionId]
        );

        // Sync the user login state
        await syncUserLoginStateFromSubscriptionId(finalSubscriptionId);

        let customerEmail = null;
        let username = null;
        let siteId = 'N/A';
        let plan = 'subscription';

        try {
          const [pmRows] = await db.query(
            'SELECT email, username, site_id, plan FROM payments WHERE stripe_subscription_id = ? LIMIT 1',
            [finalSubscriptionId]
          );
          if (pmRows && pmRows.length > 0) {
            customerEmail = pmRows[0].email;
            username = pmRows[0].username;
            siteId = pmRows[0].site_id;
            plan = pmRows[0].plan;
          }
        } catch (dbFindErr) {
          console.warn('⚠️ Could not lookup payment record for coupon notification:', dbFindErr.message);
        }

        if (!customerEmail && oldSubscription?.customer) {
          try {
            const cust = await stripe.customers.retrieve(
              typeof oldSubscription.customer === 'string' ? oldSubscription.customer : oldSubscription.customer.id
            );
            if (cust && cust.email) {
              customerEmail = cust.email;
              username = username || cust.name || customerEmail.split('@')[0];
            }
          } catch (custErr) {
            console.warn('⚠️ Could not retrieve Stripe customer email:', custErr.message);
          }
        }

        sendTeamPurchaseNotification({
          username: username || customerEmail || 'Customer',
          email: customerEmail,
          plan: plan || 'subscription',
          amount: totalAmount !== null ? toMajorUnits(totalAmount) : 0,
          currency: subscription.currency || 'USD',
          siteId: siteId || 'N/A',
          paymentId: finalSubscriptionId,
          couponCode: couponCode,
        }).catch(err => console.error('⚠️ Apply coupon team purchase notification error:', err.message));
      } catch (syncErr) {
        console.warn('⚠️ Non-critical database sync error when applying coupon:', syncErr.message);
      }
    }

    return res.json({
      clientSecret,
      discountedAmount: totalAmount,
      status: subscription.status === 'incomplete' && totalAmount === 0 ? 'active' : subscription.status,
      subscriptionId: finalSubscriptionId,
      message: 'Coupon applied successfully'
    });
  } catch (err) {
    console.error('❌ Error applying coupon:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/verify-payment
//  Called after PaymentIntent succeeds on the frontend.
// ────────────────────────────────────────────────────────────
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { paymentIntentId, siteId, framerUserId, email, plan, subscriptionId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ message: 'Missing paymentIntentId' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(402).json({ message: 'Payment has not succeeded yet.', status: paymentIntent.status });
    }

    // Pull metadata
    const meta = paymentIntent.metadata || {};
    const resolvedSiteId = siteId || meta.framer_site_id || 'unknown';
    const resolvedUserId = framerUserId || meta.framer_user_id || null;
    const resolvedPlan = plan || meta.plan_type || 'lifetime';
    const resolvedEmail = normalizeEmail(
      email ||
      paymentIntent.receipt_email ||
      meta.framer_user_email ||
      paymentIntent.charges?.data?.[0]?.billing_details?.email ||
      null
    );
    const userLogin = await getUserLoginByEmail(resolvedEmail);
    const userLoginId = userLogin?.id || null;
    const resolvedUserName = userLogin?.username || meta.framer_user_name || null;

    // Retrieve subscriptionId from stripe if missing but present on invoice
    let resolvedSubscriptionId = subscriptionId || null;
    if (!resolvedSubscriptionId && paymentIntent.invoice) {
      try {
        const invoice = await stripe.invoices.retrieve(paymentIntent.invoice);
        if (invoice.subscription) {
          resolvedSubscriptionId = typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription.id;
        }
      } catch (err) {
        console.warn('⚠️ Could not retrieve invoice/subscription from Stripe for payment intent:', err.message);
      }
    }

    // ── Helper to calculate expiry date based on plan ──
    const now = new Date();
    let expiresAt = null;
    if (resolvedPlan === 'monthly') {
      now.setMonth(now.getMonth() + 1);
      expiresAt = now.toISOString().slice(0, 19).replace('T', ' ');
    } else if (resolvedPlan === 'yearly') {
      now.setFullYear(now.getFullYear() + 1);
      expiresAt = now.toISOString().slice(0, 19).replace('T', ' ');
    }

    // Insert or update the payments table directly
    await db.query(
      `INSERT INTO payments (
        user_login_id,
        username,
        site_id,
        framer_user_id,
        plan,
        email,
        stripe_customer_id,
        payment_intent_id,
        stripe_subscription_id,
        amount,
        currency,
        status,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        user_login_id = COALESCE(VALUES(user_login_id), user_login_id),
        username = COALESCE(VALUES(username), username),
        framer_user_id = COALESCE(VALUES(framer_user_id), framer_user_id),
        status = 'paid',
        plan = VALUES(plan),
        email = COALESCE(VALUES(email), email),
        stripe_customer_id = COALESCE(VALUES(stripe_customer_id), stripe_customer_id),
        payment_intent_id = VALUES(payment_intent_id),
        stripe_subscription_id = COALESCE(VALUES(stripe_subscription_id), stripe_subscription_id),
        amount = VALUES(amount),
        currency = VALUES(currency),
        expires_at = VALUES(expires_at)`,
      [
        userLoginId,
        resolvedUserName,
        resolvedSiteId,
        resolvedUserId,
        resolvedPlan,
        resolvedEmail,
        paymentIntent.customer || null,
        paymentIntentId,
        resolvedSubscriptionId,
        toMajorUnits(paymentIntent.amount),
        paymentIntent.currency,
        'paid',
        expiresAt
      ]
    );

    await syncUserLoginSubscriptionState({
      userLoginId,
      email: resolvedEmail,
      plan: resolvedPlan,
      status: 'paid',
    });

    // ── Set default payment method on the Stripe customer (populates Primary Payment Method column) ──
    const paymentMethodId = paymentIntent.payment_method;
    const customerId = paymentIntent.customer;
    if (customerId && paymentMethodId) {
      try {
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
      } catch (pmErr) {
        console.warn('⚠️  Could not set default payment method on customer:', pmErr.message);
      }
    }

    // ── Create a post-payment invoice to link lifetime payments to the product in Stripe dashboard ──
    const metaPriceId = meta.price_id;
    if (resolvedPlan === 'lifetime' && customerId && metaPriceId) {
      try {
        // Create an invoice item linked to the product price
        await stripe.invoiceItems.create({
          customer: customerId,
          pricing: { price: metaPriceId },
          quantity: 1,
        });
        // Create and finalize the invoice, then mark it as already paid
        const postInvoice = await stripe.invoices.create({
          customer: customerId,
          auto_advance: false,
          collection_method: 'charge_automatically',
          description: 'Before After Image Slider – Lifetime Deal',
          metadata: {
            plan_type: 'lifetime',
            payment_intent_id: paymentIntentId,
            framer_site_id: resolvedSiteId,
          },
        });
        await stripe.invoices.finalizeInvoice(postInvoice.id);
        await stripe.invoices.pay(postInvoice.id, {
          paid_out_of_band: true,
        });
        console.log('✅ Post-payment invoice created and linked to product:', postInvoice.id);
      } catch (invErr) {
        // Non-blocking — payment is already processed, this is just for dashboard linking
        console.warn('⚠️  Could not create post-payment invoice for product linking:', invErr.message);
      }
    }

    // ── Auto-cancel any existing recurring subscriptions when purchasing Lifetime ──
    if (resolvedPlan === 'lifetime') {
      try {
        const record = await getLatestRecurringSubscriptionRecord(resolvedSiteId);
        if (record && record.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(record.status)) {
          console.log(`Cancelling existing recurring subscription ${record.stripe_subscription_id} after lifetime purchase`);
          await stripe.subscriptions.cancel(record.stripe_subscription_id);
          await db.query(
            `UPDATE payments SET status = 'cancelled', expires_at = NULL WHERE stripe_subscription_id = ?`,
            [record.stripe_subscription_id]
          );
        }
      } catch (cancelErr) {
        console.warn('⚠️ Could not auto-cancel existing subscription:', cancelErr.message);
      }
    }

    // Sync payment verification to both FluentCRM and CRMfic
    syncUserToAllCRMs(resolvedUserId || resolvedEmail, 'PAYMENT_VERIFIED').catch(err => {
      console.warn('⚠️ [CRM Webhook] Payment verify sync error:', err.message);
    });

    const resolvedCouponCode = paymentIntent.metadata?.coupon_code || paymentIntent.metadata?.coupon || null;
    sendTeamPurchaseNotification({
      username: resolvedUserName || resolvedEmail?.split('@')[0],
      email: resolvedEmail,
      plan: resolvedPlan,
      amount: toMajorUnits(paymentIntent.amount),
      currency: paymentIntent.currency,
      siteId: resolvedSiteId,
      paymentId: paymentIntentId,
      couponCode: resolvedCouponCode,
    }).catch(err => console.error('⚠️ Team purchase notification error:', err.message));

    res.json({ verified: true, plan: resolvedPlan });
  } catch (err) {
    console.error('❌ Error verifying payment:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/start-trial
//  Start a 7-day trial for a logged-in user.
// ────────────────────────────────────────────────────────────
app.post('/api/start-trial', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication required to start a trial.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ message: 'Invalid or expired authentication token.' });
    }

    const email = decoded.email;
    const { siteId, framerUserId, componentsCount, siteName, siteUrl } = req.body;

    if (!siteId) {
      return res.status(400).json({ message: 'siteId is required to start a trial.' });
    }

    const result = await startTrial(email, siteId, framerUserId, componentsCount, siteName, siteUrl);
    if (!result.success) {
      return res.status(400).json({ message: result.reason });
    }

    return res.json({
      success: true,
      message: 'Trial started successfully.',
      trialStart: result.trialStart,
      trialEnd: result.trialEnd
    });
  } catch (err) {
    console.error('❌ Error starting trial:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/check-trial-eligibility
//  Check if a site/user/email is eligible for a trial.
// ────────────────────────────────────────────────────────────
app.get('/api/check-trial-eligibility', async (req, res) => {
  try {
    const { email, siteId, userId } = req.query;
    const eligibility = await checkTrialEligibility(email, siteId, userId);
    return res.json(eligibility);
  } catch (err) {
    console.error('❌ Error checking trial eligibility:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/subscription-status
//  Frontend calls this to check if a site/user has paid.
// ────────────────────────────────────────────────────────────
app.get('/api/subscription-status', async (req, res) => {
  try {
    const { siteId, userId, email, componentsCount, siteName, siteUrl } = req.query;

    if (!siteId) {
      return res.status(400).json({ message: 'Missing siteId query parameter' });
    }

    // 1️⃣ First check for a lifetime plan for this site
    const lifetimeQueryParams = [siteId];
    const lifetimeWhere = `WHERE site_id = ? AND plan = 'lifetime' AND status = 'paid'`;

    const [lifetimeRows] = await db.query(
      `SELECT id, plan, status, expires_at, created_at, email, username
       FROM payments
       ${lifetimeWhere}
       ORDER BY id DESC LIMIT 1`,
      lifetimeQueryParams
    );

    let activeSub = null;
    let isSubscriptionActive = false;

    if (lifetimeRows.length > 0) {
      activeSub = lifetimeRows[0];
      isSubscriptionActive = true;
    } else {
      // 2️⃣ If no lifetime plan, check for the latest recurring subscription
      // using the robust helper function (matches the logic used in plan upgrades)
      activeSub = await getLatestRecurringSubscriptionRecord(siteId, email);
      if (activeSub) {
        isSubscriptionActive = true;
        // Verification: ensure the recurring plan hasn't expired
        if (activeSub.expires_at) {
          const expiryDate = new Date(activeSub.expires_at);
          if (expiryDate < new Date()) {
            // Paid period ended in the past. If we have Stripe subscription ID, check if renewed
            if (activeSub.stripe_subscription_id && ['active', 'trialing'].includes(activeSub.status)) {
              try {
                const stripeSub = await stripe.subscriptions.retrieve(activeSub.stripe_subscription_id);
                const currentPeriodEnd =
                  unixToMySQLDateTime(stripeSub.current_period_end) ||
                  unixToMySQLDateTime(stripeSub.items?.data?.[0]?.current_period_end);

                if (stripeSub.status === 'active' && currentPeriodEnd && new Date(currentPeriodEnd) > new Date()) {
                  // Subscription successfully renewed! Update DB with new period
                  await db.query(
                    `UPDATE payments SET expires_at = ?, status = ? WHERE id = ?`,
                    [currentPeriodEnd, stripeSub.status, activeSub.id]
                  );
                  activeSub.expires_at = currentPeriodEnd;
                  activeSub.status = stripeSub.status;
                  isSubscriptionActive = true;
                } else {
                  // Expired, cancelled, or past due
                  const resolvedStripeStatus = stripeSub.cancel_at_period_end ? 'Scheduled to cancel' : stripeSub.status;
                  await db.query(
                    `UPDATE payments SET status = ? WHERE id = ?`,
                    [resolvedStripeStatus, activeSub.id]
                  );
                  activeSub.status = resolvedStripeStatus;
                  isSubscriptionActive = false;
                }
              } catch (stripeErr) {
                console.warn('⚠️ Error checking Stripe subscription expiry status:', stripeErr.message);
                isSubscriptionActive = false;
              }
            } else {
              isSubscriptionActive = false;
            }
          }
        }
      }
    }

    // 3️⃣ If no active paid plan is found, check if there is an active trial for this site
    let trialRow = null;
    if (siteId) {
      const [rows] = await db.query(
        `SELECT email, site_id, framer_user_id, 
                DATE_FORMAT(trial_start, '%Y-%m-%dT%H:%i:%sZ') as trial_start_utc, 
                DATE_FORMAT(trial_end, '%Y-%m-%dT%H:%i:%sZ') as trial_end_utc
         FROM reviewfic_trials
         WHERE site_id = ?
         ORDER BY id DESC LIMIT 1`,
        [siteId]
      );
      if (rows.length > 0) {
        trialRow = rows[0];
      }
    }

    // Determine current plan status for tracking
    let currentPlanStatus = 'inactive';
    if (isSubscriptionActive && activeSub) {
      currentPlanStatus = activeSub.status || activeSub.plan || 'active';
    } else if (trialRow) {
      const now = new Date();
      const trialEnd = new Date(trialRow.trial_end_utc);
      currentPlanStatus = trialEnd > now ? 'trialing' : 'expired';
      if (currentPlanStatus === 'expired') {
        checkAndExpireTrials().catch(() => { });
      }
    }

    // Update the reviewfic_trials table with the current plan status, components count, site name, and site URL
    if (siteId || email || userId) {
      const updateParams = [currentPlanStatus];
      let updateQuery = `UPDATE reviewfic_trials SET current_plan_status = ?`;

      if (componentsCount !== undefined && componentsCount !== null) {
        updateQuery += `, components_added = ?`;
        updateParams.push(parseInt(componentsCount, 10) || 0);
      }

      if (siteName) {
        updateQuery += `, site_name = ?`;
        updateParams.push(siteName);
      }

      if (siteUrl) {
        updateQuery += `, site_url = ?`;
        updateParams.push(siteUrl);
      }

      updateQuery += ` WHERE 1=0`;
      if (siteId) {
        updateQuery += ` OR site_id = ?`;
        updateParams.push(siteId);
      }
      if (email) {
        updateQuery += ` OR email = ?`;
        updateParams.push(normalizeEmail(email));
      }
      if (userId) {
        updateQuery += ` OR framer_user_id = ?`;
        updateParams.push(userId);
      }

      try {
        await db.query(updateQuery, updateParams);
      } catch (dbErr) {
        console.warn('⚠️ Error updating reviewfic_trials tracking:', dbErr.message);
      }
    }

    // Also update the payments table with the siteName and siteUrl if available
    if (siteId && (siteName || siteUrl)) {
      const paymentUpdateParams = [];
      let paymentUpdateQuery = `UPDATE payments SET`;

      if (siteName) {
        paymentUpdateQuery += ` site_name = ?`;
        paymentUpdateParams.push(siteName);
      }
      if (siteUrl) {
        paymentUpdateQuery += `${siteName ? ',' : ''} site_url = ?`;
        paymentUpdateParams.push(siteUrl);
      }

      paymentUpdateQuery += ` WHERE site_id = ?`;
      paymentUpdateParams.push(siteId);

      try {
        await db.query(paymentUpdateQuery, paymentUpdateParams);
      } catch (dbErr) {
        console.warn('⚠️ Error updating payments site tracking:', dbErr.message);
      }
    }

    // Return response based on state
    if (isSubscriptionActive && activeSub) {
      return res.json({
        isPaid: true,
        plan: activeSub.plan,
        status: activeSub.status,
        username: activeSub.username,
        email: activeSub.email,
        expiresAt: activeSub.expires_at,
        since: activeSub.created_at,
      });
    }

    if (trialRow) {
      const now = new Date();
      const trialEnd = new Date(trialRow.trial_end_utc);
      const isTrialActive = trialEnd > now;
      const secondsRemaining = Math.max(0, Math.floor((trialEnd - now) / 1000));
      const daysRemaining = Math.ceil(secondsRemaining / 86400);

      if (isTrialActive) {
        return res.json({
          isPaid: true, // Allow trial access
          isTrial: true,
          trialEndsAt: trialRow.trial_end_utc,
          trialSecondsRemaining: secondsRemaining,
          trialDaysRemaining: daysRemaining,
          plan: 'trial',
          status: 'trialing',
          email: trialRow.email,
          since: trialRow.trial_start_utc,
        });
      } else {
        return res.json({
          isPaid: false,
          isTrial: true,
          trialEndsAt: trialRow.trial_end_utc,
          trialSecondsRemaining: 0,
          trialDaysRemaining: 0,
          plan: null,
          status: 'expired',
          email: trialRow.email,
          since: trialRow.trial_start_utc,
        });
      }
    }

    return res.json({
      isPaid: false,
      isTrial: false,
      plan: null,
      status: null,
    });
  } catch (err) {
    console.error('❌ Error checking subscription status:', err);
    res.status(500).json({ message: err.message });
  }
});

// Alias without /api/ prefix for fallback compatibility
app.get('/subscription-status', async (req, res) => {
  // Delegate to the main handler by forwarding to it
  req.url = '/api/subscription-status';
  app.handle(req, res);
});

// ────────────────────────────────────────────────────────────
//  GET /api/lifetime-availability
//  Check how many lifetime spots remain.
// ────────────────────────────────────────────────────────────
app.get('/api/lifetime-availability', async (req, res) => {
  try {
    const maxLifetime = parseInt(process.env.LIFETIME_DEAL_MAX_USERS || '20', 10);
    const [rows] = await db.query(
      "SELECT COUNT(*) as count FROM payments WHERE plan = 'lifetime' AND status = 'paid'"
    );
    const taken = rows[0].count;
    const remaining = Math.max(0, maxLifetime - taken);

    res.json({ total: maxLifetime, taken, remaining, soldOut: remaining === 0 });
  } catch (err) {
    console.error('❌ Error checking lifetime availability:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/billing-portal-url
//  Create a Stripe customer portal session URL
// ────────────────────────────────────────────────────────────
const handleCreateBillingPortalSession = async (req, res) => {
  try {
    const { siteId } = req.query;

    if (!siteId) {
      return res.status(400).json({ message: 'Missing siteId query parameter' });
    }

    // Get the customer ID from the payments table
    const [rows] = await db.query(
      `SELECT stripe_customer_id FROM payments
       WHERE site_id = ? AND stripe_customer_id IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [siteId]
    );

    if (rows.length === 0 || !rows[0].stripe_customer_id) {
      return res.status(404).json({ message: 'No active subscription found for this site' });
    }

    if (!stripe) {
      return res.json({ url: process.env.RETURN_URL || 'https://app.framefic.com/reviewfic' });
    }

    const customerId = rows[0].stripe_customer_id;

    // Create a customer portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.RETURN_URL || 'https://app.framefic.com/reviewfic',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Error creating billing portal session:', err);
    res.status(500).json({ message: err.message });
  }
};
app.get('/api/billing-portal-url', handleCreateBillingPortalSession);
app.get('/billing-portal-url', handleCreateBillingPortalSession);

// ────────────────────────────────────────────────────────────
//  POST /api/subscription/cancel
//  Schedule cancellation at the end of current billing cycle.
// ────────────────────────────────────────────────────────────
const handleCancelSubscription = async (req, res) => {
  try {
    const { siteId, feedback } = req.body;

    if (!siteId) {
      return res.status(400).json({ message: 'Missing siteId' });
    }

    if (!stripe) {
      await db.query(
        "UPDATE payments SET status = 'Scheduled to cancel' WHERE site_id = ? ORDER BY id DESC LIMIT 1",
        [siteId]
      );
      return res.json({
        success: true,
        message: 'Subscription scheduled to cancel at end of billing period (dev mode).',
        status: 'Scheduled to cancel',
      });
    }

    let record = await getLatestRecurringSubscriptionRecord(siteId);

    // Fallback: if we don't have a stored subscription id, try to find one via the customer id
    if (!record?.stripe_subscription_id) {
      const [custRows] = await db.query(
        `SELECT stripe_customer_id FROM payments WHERE site_id = ? AND stripe_customer_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
        [siteId]
      );

      if (custRows.length > 0 && custRows[0].stripe_customer_id) {
        const customerId = custRows[0].stripe_customer_id;
        // List recent subscriptions for this customer from Stripe and pick the first active-ish one
        const subsList = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
        const found = (subsList?.data || []).find((s) =>
          ['active', 'trialing', 'past_due', 'Scheduled to cancel', 'incomplete', 'unpaid'].includes(s.status) &&
          s.metadata?.framer_site_id === siteId
        );
        if (found) {
          record = {
            stripe_subscription_id: found.id,
            stripe_customer_id: customerId,
            plan: found.metadata?.plan_type || null,
          };
        }
      }
    }

    if (!record?.stripe_subscription_id) {
      return res.status(404).json({ message: 'No active recurring subscription found for this site' });
    }

    const updatedSubscription = await stripe.subscriptions.update(record.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    const periodEnd = unixToMySQLDateTime(updatedSubscription.current_period_end);

    // If we discovered the subscription via customer fallback, ensure the payments row records the subscription id
    if (record.stripe_customer_id) {
      await db.query(
        `UPDATE payments
         SET stripe_subscription_id = COALESCE(stripe_subscription_id, ?)
         WHERE stripe_customer_id = ?`,
        [updatedSubscription.id, record.stripe_customer_id]
      );
    }

    await db.query(
      `UPDATE payments
       SET status = ?, expires_at = ?, user_feedback = COALESCE(?, user_feedback)
       WHERE stripe_subscription_id = ?`,
      ['Scheduled to cancel', periodEnd, feedback || null, updatedSubscription.id]
    );

    // Also store feedback in userlogin table if available
    const resolvedUserLoginId = record.user_login_id || null;
    const resolvedEmail = record.email || null;
    if (resolvedUserLoginId) {
      await db.query(
        `UPDATE \`reviewfic-userlogin\`
         SET user_feedback = COALESCE(?, user_feedback)
         WHERE id = ?`,
        [feedback || null, resolvedUserLoginId]
      );
    } else if (resolvedEmail) {
      await db.query(
        `UPDATE \`reviewfic-userlogin\`
         SET user_feedback = COALESCE(?, user_feedback)
         WHERE email = ?`,
        [feedback || null, resolvedEmail]
      );
    }

    await syncUserLoginStateFromSubscriptionId(updatedSubscription.id);

    sendTeamCancellationNotification({
      username: record.username || (resolvedEmail ? resolvedEmail.split('@')[0] : 'Customer'),
      email: resolvedEmail || record.email,
      plan: record.plan || updatedSubscription.metadata?.plan_type || 'subscription',
      siteId: siteId,
      subscriptionId: updatedSubscription.id,
      status: 'Scheduled to cancel at end of billing cycle',
      effectiveDate: periodEnd,
      feedback: feedback || null,
      framerSiteName: null,
      framerSiteUrl: null,
    }).catch(err => console.error('⚠️ Team cancellation notification error:', err.message));

    const cancelEmail = resolvedEmail || record.email;
    const cancelUsername = record.username || (cancelEmail ? cancelEmail.split('@')[0] : 'Customer');
    const cancelPlan = record.plan || updatedSubscription.metadata?.plan_type || 'subscription';

    // Dispatch short & meaningful tag 'Reviewfic-Cancelled' to CRMfic and FluentCRM
    if (cancelEmail) {
      forwardToCRMfic({
        email: cancelEmail,
        username: cancelUsername,
        status: 'Subscribed',
        list: ['App Users', 'Reviewfic'],
        tags: ['Reviewfic-Cancelled', 'Reviewfic'],
        plan: cancelPlan,
        paymentStatus: 'cancelled',
        subscriptionId: updatedSubscription.id,
        effectiveDate: periodEnd,
        cancellationReason: feedback || null,
        event: 'plan_canceled',
      }).catch(err => console.warn('⚠️ CRMfic plan canceled sync error (endpoint):', err.message));

      forwardToFluentCRM({
        email: cancelEmail,
        username: cancelUsername,
        status: 'subscribed',
        list: ['App Users', 'Reviewfic'],
        tags: ['Reviewfic-Cancelled', 'Reviewfic'],
        plan: cancelPlan,
        paymentStatus: 'cancelled',
        subscriptionId: updatedSubscription.id,
        effectiveDate: periodEnd,
        cancellationReason: feedback || null,
        event: 'plan_canceled',
      }).catch(err => console.warn('⚠️ FluentCRM plan canceled sync error (endpoint):', err.message));
    }

    return res.json({
      success: true,
      status: updatedSubscription.status,
      cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
      currentPeriodEnd: periodEnd,
      subscriptionId: updatedSubscription.id,
    });
  } catch (err) {
    console.error('❌ Error scheduling cancellation:', err);
    res.status(500).json({ message: err.message });
  }
};
app.post('/api/subscription/cancel', handleCancelSubscription);
app.post('/subscription/cancel', handleCancelSubscription);

// ────────────────────────────────────────────────────────────
//  POST /api/subscription/change-plan
//  Change plan: upgrade (monthly→yearly) or downgrade (yearly→monthly).
//  Upgrades apply immediately with proration credit.
//  Downgrades schedule the switch at end of current billing period.
// ────────────────────────────────────────────────────────────
const handleChangePlan = async (req, res) => {
  try {
    const { siteId, targetPlan } = req.body;

    if (!siteId) {
      return res.status(400).json({ message: 'Missing siteId' });
    }

    const record = await getLatestRecurringSubscriptionRecord(siteId);
    if (!record?.stripe_subscription_id) {
      return res.status(404).json({ message: 'No active recurring subscription found for this site' });
    }

    const currentPlan = record.plan;
    const resolvedTargetPlan = targetPlan || (currentPlan === 'monthly' ? 'yearly' : null);

    if (!resolvedTargetPlan || !['monthly', 'yearly'].includes(resolvedTargetPlan)) {
      return res.status(400).json({ message: 'Invalid target plan. Expected monthly or yearly.' });
    }

    if (currentPlan === resolvedTargetPlan) {
      return res.status(400).json({ message: `Subscription is already on ${resolvedTargetPlan} plan.` });
    }

    if (currentPlan === 'yearly' && resolvedTargetPlan === 'monthly') {
      return res.status(400).json({ message: 'Downgrading from yearly to monthly is not supported.' });
    }

    const priceMap = getPriceMap();
    const targetPriceId = priceMap[resolvedTargetPlan];
    if (!targetPriceId) {
      return res.status(500).json({ message: `Stripe price is not configured for plan: ${resolvedTargetPlan}` });
    }

    const currentSubscription = await stripe.subscriptions.retrieve(record.stripe_subscription_id);
    if (!currentSubscription || ['canceled', 'cancelled', 'incomplete_expired'].includes(currentSubscription.status)) {
      await db.query(
        `UPDATE payments SET status = 'cancelled' WHERE stripe_subscription_id = ?`,
        [record.stripe_subscription_id]
      ).catch(() => {});
      return res.status(400).json({
        requiresNewCheckout: true,
        message: 'This subscription has ended. Please choose a plan to start a new subscription.',
      });
    }

    const subscriptionItemId = currentSubscription.items?.data?.[0]?.id;
    if (!subscriptionItemId) {
      return res.status(400).json({
        requiresNewCheckout: true,
        message: 'No updatable subscription item found in Stripe. Please choose a plan to start a new subscription.',
      });
    }

    const isUpgrade = currentPlan === 'monthly' && resolvedTargetPlan === 'yearly';
    const isDowngrade = currentPlan === 'yearly' && resolvedTargetPlan === 'monthly';

    let updatedSubscription;

    if (isUpgrade || isDowngrade) {
      // ── Apply immediately with proration credit/charge ──
      updatedSubscription = await stripe.subscriptions.update(record.stripe_subscription_id, {
        items: [{ id: subscriptionItemId, price: targetPriceId }],
        proration_behavior: 'create_prorations',
        payment_behavior: 'allow_incomplete',
        cancel_at_period_end: false,
        billing_cycle_anchor: 'now',
        metadata: {
          ...(currentSubscription.metadata || {}),
          plan_type: resolvedTargetPlan,
          ...(isDowngrade ? { downgraded_from: currentPlan } : {}),
        },
      });
    }

    const periodEnd = unixToMySQLDateTime(updatedSubscription.current_period_end);
    const status = updatedSubscription.status;

    await db.query(
      `UPDATE payments
       SET plan = ?, status = ?, expires_at = ?
       WHERE stripe_subscription_id = ?`,
      [resolvedTargetPlan, status, periodEnd, record.stripe_subscription_id]
    );

    await syncUserLoginSubscriptionState({
      userLoginId: record.user_login_id || null,
      email: record.email || null,
      plan: resolvedTargetPlan,
      status,
    });

    await syncUserLoginStateFromSubscriptionId(record.stripe_subscription_id);

    return res.json({
      success: true,
      previousPlan: currentPlan,
      plan: resolvedTargetPlan,
      direction: isUpgrade ? 'upgrade' : 'downgrade',
      status,
      currentPeriodEnd: periodEnd,
      subscriptionId: updatedSubscription.id,
      message: status === 'past_due' || status === 'incomplete'
        ? `Plan changed, but payment failed. Please update your billing details.`
        : (isDowngrade
          ? `Successfully switched to monthly. Any unused yearly time has been credited to your account.`
          : `Successfully upgraded to yearly plan with proration applied.`),
    });
  } catch (err) {
    console.error('❌ Error changing subscription plan:', err);
    const errText = String(err?.message || '');
    if (errText.includes('canceled subscription') || errText.includes('cancelled subscription')) {
      return res.status(400).json({
        requiresNewCheckout: true,
        message: 'This subscription has ended. Please choose a plan to start a new subscription.',
      });
    }
    res.status(500).json({ message: err.message });
  }
};
app.post('/api/subscription/change-plan', handleChangePlan);
app.post('/subscription/change-plan', handleChangePlan);
// Backward compatibility
app.post('/api/subscription/upgrade', handleChangePlan);
app.post('/subscription/upgrade', handleChangePlan);


// ────────────────────────────────────────────────────────────
//  Reviewfic Live Review Engine (Google Places & Trustpilot)
// ────────────────────────────────────────────────────────────

// 1. Google Places Search / Autocomplete
app.get(['/api/v1/places/predictions', '/api/v1/places/search', '/api/places/predictions'], async (req, res) => {
  try {
    const searchInput = req.query.input || req.query.q || '';
    if (!searchInput.trim()) {
      return res.json({ predictions: [], results: [] });
    }
    const data = await searchGooglePlaces(searchInput);
    res.json(data);
  } catch (err) {
    console.error('❌ Error in /places/search:', err.message);
    res.status(500).json({ error: err.message, predictions: [], results: [] });
  }
});

// 2. Google Place Details & Reviews
app.get(['/api/v1/places/details', '/api/places/details'], async (req, res) => {
  try {
    const placeId = req.query.place_id || req.query.placeId;
    const forceRefresh = req.query.refresh === '1' || req.query.force === 'true';
    if (!placeId) {
      return res.status(400).json({ error: 'place_id is required' });
    }
    const data = await getGooglePlaceDetails(placeId, { forceRefresh });
    res.json(data);
  } catch (err) {
    console.error('❌ Error in /places/details:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Trustpilot Verification
app.get(['/api/v1/trustpilot/verify', '/api/v1/config/trustpilot', '/config/trustpilot'], async (req, res) => {
  try {
    const domain = req.query.domain || req.query.businessUrl || req.query.q;
    if (!domain) {
      return res.status(400).json({ error: 'domain or businessUrl is required' });
    }
    const data = await verifyTrustpilotBusiness(domain);
    res.json(data);
  } catch (err) {
    console.error('❌ Error in /trustpilot/verify:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Trustpilot Reviews Fetching
app.get(['/api/v1/trustpilot/reviews', '/api/reviews/trustpilot', '/reviews/trustpilot'], async (req, res) => {
  try {
    const domain = req.query.domain || req.query.businessUrl;
    const limit = parseInt(req.query.limit || '20', 10);
    const forceRefresh = req.query.refresh === '1';
    if (!domain) {
      return res.status(400).json({ error: 'domain or businessUrl is required' });
    }
    const data = await getTrustpilotReviews(domain, { limit, forceRefresh });
    res.json(data);
  } catch (err) {
    console.error('❌ Error in /trustpilot/reviews:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5. Multi-Business Storage / Sync API
app.get('/api/v1/businesses', async (req, res) => {
  try {
    const siteToken = req.query.siteToken || 'default_site';
    const [rows] = await db.query('SELECT * FROM businesses WHERE site_token = ? ORDER BY updated_at DESC', [siteToken]);
    res.json({ businesses: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/v1/businesses/save', async (req, res) => {
  try {
    const { id, siteToken = 'default_site', name, googlePlaceId, googleBusinessName, trustpilotDomain, metadata } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }
    await db.query(
      `INSERT INTO businesses (id, site_token, name, google_place_id, google_business_name, trustpilot_domain, metadata, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         google_place_id = VALUES(google_place_id),
         google_business_name = VALUES(google_business_name),
         trustpilot_domain = VALUES(trustpilot_domain),
         metadata = VALUES(metadata),
         last_synced_at = NOW();`,
      [
        id,
        siteToken,
        name,
        googlePlaceId || null,
        googleBusinessName || null,
        trustpilotDomain || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
    res.json({ ok: true, id, name });
  } catch (err) {
    console.error('❌ Error in /businesses/save:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6. View & Sync Usage Tracking
app.post('/api/v1/track/usage', async (req, res) => {
  try {
    const { siteToken = 'default_site', businessId, actionType = 'view' } = req.body || {};
    await db.query(
      'INSERT INTO usage_tracking (site_token, business_id, action_type) VALUES (?, ?, ?)',
      [siteToken, businessId || null, actionType]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ────────────────────────────────────────────────────────────
//  Health check
// ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ────────────────────────────────────────────────────────────
//  Start
// ────────────────────────────────────────────────────────────
async function startServer() {
  try {
    await initializeDb();
    app.listen(PORT, () => {
      console.log(`🚀 Backend running on http://localhost:${PORT}`);
      // Initial check for expired trials and schedule recurring check every 15 minutes
      checkAndExpireTrials().catch(err => console.warn('⚠️ Initial trial expiration check warning:', err.message));
      setInterval(() => {
        checkAndExpireTrials().catch(err => console.warn('⚠️ Scheduled trial expiration check warning:', err.message));
      }, 15 * 60 * 1000);

      // ────────────────────────────────────────────────────────────
      //  CRMfic Auto-Reconciliation Engine:
      //  Detects and synchronizes any contacts that missed automatic sync
      // ────────────────────────────────────────────────────────────
      const autoSyncIntervalMinutes = parseInt(process.env.CRMFIC_AUTO_SYNC_INTERVAL_MINUTES, 10) || 10;
      const autoSyncIntervalMs = autoSyncIntervalMinutes * 60 * 1000;

      // Run initial reconciliation after short boot delay (5 seconds)
      setTimeout(() => {
        console.log('🔄 [CRMfic Engine] Running initial missed contact reconciliation check...');
        autoSyncMissedContactsToCRMfic({ limit: 100, forceAll: false })
          .then(res => {
            if (res && res.totalFound > 0) {
              console.log(`✅ [CRMfic Engine] Initial auto-sync: ${res.syncedCount}/${res.totalFound} missed contacts synced to CRMfic.`);
            } else {
              console.log('✨ [CRMfic Engine] Initial check: All contacts are up to date with CRMfic.');
            }
          })
          .catch(err => console.warn('⚠️ CRMfic initial auto-sync warning:', err.message));
      }, 5000);

      // Periodic check every CRMFIC_AUTO_SYNC_INTERVAL_MINUTES
      setInterval(() => {
        autoSyncMissedContactsToCRMfic({ limit: 100, forceAll: false })
          .then(res => {
            if (res && res.totalFound > 0) {
              console.log(`✅ [CRMfic Engine] Scheduled auto-sync: ${res.syncedCount}/${res.totalFound} missed contacts synced to CRMfic.`);
            }
          })
          .catch(err => console.warn('⚠️ CRMfic periodic auto-sync warning:', err.message));
      }, autoSyncIntervalMs);
    });
  } catch (err) {
    if (err?.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('❌ Database authentication failed (ER_ACCESS_DENIED_ERROR).');
      console.error('   Check Coolify DB env vars: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (or DB_URL).');
      console.error(`   Current DB target: host=${process.env.DB_HOST || 'N/A'} user=${process.env.DB_USER || 'N/A'} db=${process.env.DB_NAME || 'N/A'}`);
      console.error('   Also ensure MySQL grants allow this app host/IP to connect.');
    } else {
      console.error('❌ Failed to initialize database:', err);
    }
    process.exit(1);
  }
}

startServer();
