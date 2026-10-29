import db from './db.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Default Webhook Endpoints
const DEFAULT_CRMFIC_WEBHOOK_URL = 'https://beta.crmfic.com/api/webhooks/receive/9248ccaa-04f0-4afd-879f-e6b11a65f90e';
const DEFAULT_MAILERPRESS_WEBHOOK_URL = 'https://framefic.com/wp-json/mailerpress/v1/webhooks/receive/webhook-1792506535204';

// ────────────────────────────────────────────────────────────
//  Helper: Resolve Names from username / email
// ────────────────────────────────────────────────────────────
export function resolveNames(username = '', firstName = '', lastName = '', normalizedEmail = '') {
  let resolvedFirstName = firstName;
  let resolvedLastName = lastName;

  if (!resolvedFirstName && username) {
    const parts = username.trim().split(' ');
    resolvedFirstName = parts[0] || normalizedEmail.split('@')[0];
    resolvedLastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
  }
  if (!resolvedFirstName) {
    resolvedFirstName = normalizedEmail.split('@')[0] || '';
  }

  return {
    firstName: resolvedFirstName,
    lastName: resolvedLastName,
    fullName: `${resolvedFirstName} ${resolvedLastName}`.trim(),
  };
}

// ────────────────────────────────────────────────────────────
//  Helper: Lifecycle Tag Taxonomy (Exact 7 User Tags)
//  - Signup / OTP / Social      -> Signup Users
//  - Start Free Trial           -> Trial Users
//  - Trial Expired (Day 7)      -> Trial Expired
//  - New Paid Purchase          -> Paid Users
//  - Subscription Renewal       -> Renewed Users
//  - Plan Cancelled             -> Cancelled Users
//  - Payment Failed             -> Payment Failed
// ────────────────────────────────────────────────────────────
export function resolveLifecycleTag(input = '', paymentStatus = null) {
  const lower = String(input || '').toLowerCase().trim();

  // 1. Subscription Renewal
  if (
    lower.includes('renew') ||
    lower.includes('recurring') ||
    lower.includes('subscription_cycle') ||
    lower === 'renewed users'
  ) {
    return 'Renewed Users';
  }

  // 2. Plan Cancelled
  if (
    lower.includes('cancel') ||
    lower.includes('churn') ||
    lower === 'cancelled users' ||
    lower === 'canceled users'
  ) {
    return 'Cancelled Users';
  }

  // 3. Payment Failed
  if (
    lower.includes('fail') ||
    lower.includes('past_due') ||
    lower.includes('incomplete') ||
    lower.includes('decline') ||
    lower === 'payment failed'
  ) {
    return 'Payment Failed';
  }

  // 4. Trial Expired
  if (
    lower.includes('expire') ||
    lower.includes('trial_ended') ||
    lower === 'trial expired'
  ) {
    return 'Trial Expired';
  }

  // 5. New Paid Purchase
  if (
    lower.includes('paid') ||
    lower.includes('purchase') ||
    lower.includes('checkout') ||
    lower.includes('order') ||
    lower === 'paid users'
  ) {
    return 'Paid Users';
  }

  // 6. Start Free Trial
  if (
    lower.includes('trial') ||
    lower === 'trial users' ||
    lower === 'start_trial' ||
    lower === 'trial_started'
  ) {
    return 'Trial Users';
  }

  // 7. Signup / OTP / Social
  if (
    lower.includes('signup') ||
    lower.includes('register') ||
    lower.includes('otp') ||
    lower.includes('social') ||
    lower.includes('google') ||
    lower.includes('login') ||
    lower === 'signup users'
  ) {
    return 'Signup Users';
  }

  // Fallback by paymentStatus
  if (paymentStatus === 'paid') return 'Paid Users';
  if (paymentStatus === 'cancelled') return 'Cancelled Users';
  if (paymentStatus === 'failed') return 'Payment Failed';
  if (paymentStatus === 'expired') return 'Trial Expired';
  if (paymentStatus === 'trialing') return 'Trial Users';

  return 'Signup Users';
}

// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
//  Helper: Resolve Lists & Tags arrays and strings
//  - Lists: ['App Users', 'Reviewfic'] (strictly fixed taxonomy, no extra lists)
//  - Tags:  ['<PrimaryTag>'] (one of the 7 specified tags)
// ────────────────────────────────────────────────────────────
export function resolveListsAndTags(rawList, rawTags, plan, eventOrStatus = null) {
  // Required list convention: strictly "App Users" + "Reviewfic" (no extra lists allowed)
  const listArray = ['App Users', 'Reviewfic'];

  // Resolve Primary Lifecycle Tag
  let primaryCandidate = '';
  if (Array.isArray(rawTags) && rawTags.length > 0) {
    primaryCandidate = rawTags[0];
  } else if (typeof rawTags === 'string' && rawTags.trim()) {
    primaryCandidate = rawTags.split(',')[0].trim();
  } else if (eventOrStatus) {
    primaryCandidate = String(eventOrStatus);
  }

  const primaryTag = resolveLifecycleTag(primaryCandidate, null);
  const tagArray = [primaryTag];

  return {
    listArray,
    primaryList: 'App Users',
    tagArray,
    primaryTag,
  };
}

// ────────────────────────────────────────────────────────────
//  CRMFIC Webhook Engine (CRMFIC_WEBHOOK_URL)
// ────────────────────────────────────────────────────────────

/**
 * Dispatch contact lifecycle event to CRMfic incoming webhook endpoint.
 * Format:
 * {
 *   "email": "alex.smith@example.com",
 *   "first_name": "Alex",
 *   "last_name": "Smith",
 *   "lists": ["App Users", "Reviewfic"],
 *   "tags": ["Trial Users"]
 * }
 */
export async function forwardToCRMfic({
  email,
  username = '',
  firstName = '',
  lastName = '',
  phone = '',
  prefix = '',
  status = 'Subscribed',
  list = ['App Users', 'Reviewfic'],
  tags = null,
  plan = null,
  paymentStatus = null,
  siteName = null,
  siteUrl = null,
  event = 'user_updated',
  amount = null,
  currency = 'USD',
  paymentId = null,
  subscriptionId = null,
  invoiceId = null,
  failureReason = null,
  cancellationReason = null,
  effectiveDate = null,
  billingReason = null,
}) {
  const url = process.env.CRMFIC_WEBHOOK_URL || DEFAULT_CRMFIC_WEBHOOK_URL;
  if (!url) return false;

  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) return false;

  const { firstName: resolvedFirstName, lastName: resolvedLastName, fullName } = resolveNames(username, firstName, lastName, normalizedEmail);
  const { listArray, primaryTag, tagArray } = resolveListsAndTags(list, tags, plan, event || paymentStatus);
  const formattedStatus = status || 'Subscribed';

  // CRMfic standard payload matching user specification + non-overwrite append directives
  const jsonPayload = {
    email: normalizedEmail,
    first_name: resolvedFirstName,
    last_name: resolvedLastName || '',
    name: fullName,
    username: username || fullName,
    phone: phone || '',
    prefix: prefix || '',
    status: formattedStatus,
    status_name: formattedStatus,
    lists: listArray,
    'lists[]': listArray,
    tags: tagArray,
    'tags[]': tagArray,
    tag: primaryTag,
    tag_name: primaryTag,
    // Explicit non-overwrite & append directives for CRMfic webhook processor
    overwrite_tags: false,
    overwrite_lists: false,
    append_tags: true,
    append_lists: true,
    replace_tags: false,
    replace_lists: false,
    update_existing: true,
    sync_mode: 'append',
    update_mode: 'append',
    tag_mode: 'append',
    list_mode: 'append',
    tag_action: 'add',
    list_action: 'add',
    tags_action: 'add',
    lists_action: 'add',
    // Metadata & Tracking
    source: 'Webhook: Framefic-Reviewfic',
    app_name: 'Reviewfic',
    site_name: siteName || '',
    site_url: siteUrl || '',
    framer_site_name: siteName || '',
    framer_site_url: siteUrl || '',
    website: siteUrl || '',
    plan: plan || '',
    payment_status: paymentStatus || '',
    event: event || 'user_updated',
    // Order / Billing details
    amount: amount !== null && amount !== undefined ? amount : '',
    currency: currency || 'USD',
    payment_id: paymentId || '',
    subscription_id: subscriptionId || '',
    invoice_id: invoiceId || paymentId || '',
    failure_reason: failureReason || '',
    cancellation_reason: cancellationReason || '',
    effective_date: effectiveDate || '',
    billing_reason: billingReason || '',
  };

  // Form-urlencoded fallback payload
  const formData = new URLSearchParams();
  formData.append('email', normalizedEmail);
  formData.append('first_name', resolvedFirstName);
  formData.append('last_name', resolvedLastName || '');
  formData.append('name', fullName);
  if (phone) formData.append('phone', phone);
  if (prefix) formData.append('prefix', prefix);
  formData.append('status', formattedStatus);
  formData.append('source', 'Webhook: Framefic-Reviewfic');
  formData.append('app_name', 'Reviewfic');
  formData.append('event', event || 'user_updated');

  listArray.forEach(l => {
    formData.append('lists[]', l);
  });
  tagArray.forEach(t => {
    formData.append('tags[]', t);
  });
  formData.append('tag', primaryTag);
  formData.append('tag_name', primaryTag);

  formData.append('overwrite_tags', 'false');
  formData.append('overwrite_lists', 'false');
  formData.append('append_tags', 'true');
  formData.append('append_lists', 'true');
  formData.append('replace_tags', 'false');
  formData.append('replace_lists', 'false');
  formData.append('update_existing', 'true');
  formData.append('sync_mode', 'append');
  formData.append('update_mode', 'append');
  formData.append('tag_mode', 'append');
  formData.append('list_mode', 'append');

  if (plan) formData.append('plan', plan);
  if (paymentStatus) formData.append('payment_status', paymentStatus);
  if (siteName) formData.append('site_name', siteName);
  if (siteUrl) formData.append('site_url', siteUrl);
  if (amount !== null && amount !== undefined) formData.append('amount', String(amount));
  if (currency) formData.append('currency', currency);
  if (paymentId) formData.append('payment_id', paymentId);
  if (subscriptionId) formData.append('subscription_id', subscriptionId);
  if (failureReason) formData.append('failure_reason', failureReason);
  if (cancellationReason) formData.append('cancellation_reason', cancellationReason);
  if (effectiveDate) formData.append('effective_date', effectiveDate);

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Attempt 1: JSON payload
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const jsonResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(jsonPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (jsonResponse.ok) {
        console.log(`✅ [CRMfic Webhook] Sent successfully for ${normalizedEmail} (Lists: [${listArray.join(', ')}], Tag: "${primaryTag}", Event: ${event})`);
        markContactAsCRMficSynced(normalizedEmail).catch(() => {});
        return true;
      } else {
        const errText = await jsonResponse.text().catch(() => '');
        console.warn(`⚠️ [CRMfic Webhook] JSON POST attempt ${attempt} returned status ${jsonResponse.status}: ${errText}`);
      }
    } catch (err) {
      console.warn(`⚠️ [CRMfic Webhook] JSON POST attempt ${attempt} failed: ${err.message}`);
    }

    // Attempt 2: Form-urlencoded fallback
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const formResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: formData.toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (formResponse.ok) {
        console.log(`✅ [CRMfic Webhook] Form payload sent successfully for ${normalizedEmail} (Lists: [${listArray.join(', ')}], Tag: "${primaryTag}", Event: ${event})`);
        markContactAsCRMficSynced(normalizedEmail).catch(() => {});
        return true;
      }
    } catch (err) {
      console.warn(`⚠️ [CRMfic Webhook] Form POST attempt ${attempt} failed: ${err.message}`);
    }

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }

  return false;
}

// ────────────────────────────────────────────────────────────
//  MailerPress / FluentCRM Webhook Engine (WEBHOOK_URL / WP_WEBHOOK_URL)
// ────────────────────────────────────────────────────────────

/**
 * Dispatch contact lifecycle event to MailerPress / FluentCRM incoming webhook endpoint.
 * Format:
 * {
 *   "email": "msunvi13@gmail.com",
 *   "status": "subscribed",
 *   "lists": ["App Users", "Reviewfic"],
 *   "tag_name": ["Trial Users"],
 *   "event": "trial_expired"
 * }
 */
export async function forwardToFluentCRM({
  email,
  username = '',
  firstName = '',
  lastName = '',
  name = '',
  phone = '',
  status = 'subscribed',
  list = ['App Users', 'Reviewfic'],
  tags = null,
  plan = null,
  paymentStatus = null,
  siteName = null,
  siteUrl = null,
  event = 'user_updated',
  amount = null,
  currency = 'USD',
  paymentId = null,
  subscriptionId = null,
  failureReason = null,
  cancellationReason = null,
  effectiveDate = null,
}) {
  const url = process.env.WEBHOOK_URL || process.env.WP_WEBHOOK_URL || process.env.FLUENTCRM_WEBHOOK_URL || DEFAULT_MAILERPRESS_WEBHOOK_URL;
  if (!url) return false;

  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) return false;

  const { firstName: resolvedFirstName, lastName: resolvedLastName, fullName } = resolveNames(username, firstName, lastName, normalizedEmail);
  const displayName = name || fullName;
  const { listArray, primaryTag, tagArray } = resolveListsAndTags(list, tags, plan, event || paymentStatus);
  const formattedStatus = (status || 'subscribed').toLowerCase();

  // Exact MailerPress format requested by user
  const jsonPayload = {
    email: normalizedEmail,
    status: formattedStatus,
    lists: listArray,
    tag_name: tagArray,
    event: event || 'user_updated',
    // User fields
    first_name: resolvedFirstName,
    last_name: resolvedLastName || '',
    name: displayName,
    full_name: displayName,
    username: username || displayName,
    tags: tagArray,
    'tags[]': tagArray,
    'lists[]': listArray,
    source: 'Framefic-Reviewfic',
    app_name: 'Reviewfic',
    site_name: siteName || '',
    site_url: siteUrl || '',
    plan: plan || '',
    payment_status: paymentStatus || '',
    amount: amount !== null && amount !== undefined ? amount : '',
    currency: currency || 'USD',
    payment_id: paymentId || '',
    subscription_id: subscriptionId || '',
    failure_reason: failureReason || '',
    cancellation_reason: cancellationReason || '',
    effective_date: effectiveDate || '',
  };

  // Form-urlencoded fallback
  const formData = new URLSearchParams();
  formData.append('email', normalizedEmail);
  formData.append('status', formattedStatus);
  formData.append('event', event || 'user_updated');
  formData.append('first_name', resolvedFirstName);
  formData.append('last_name', resolvedLastName || '');
  formData.append('name', displayName);
  formData.append('source', 'Framefic-Reviewfic');
  formData.append('app_name', 'Reviewfic');

  listArray.forEach(l => {
    formData.append('lists[]', l);
  });
  tagArray.forEach(t => {
    formData.append('tag_name[]', t);
    formData.append('tags[]', t);
  });
  formData.append('tag', primaryTag);
  formData.append('tag_name', primaryTag);

  if (plan) formData.append('plan', plan);
  if (siteName) formData.append('site_name', siteName);
  if (siteUrl) formData.append('site_url', siteUrl);
  if (amount !== null && amount !== undefined) formData.append('amount', String(amount));
  if (currency) formData.append('currency', currency);

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Attempt 1: JSON payload
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const jsonResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(jsonPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (jsonResponse.ok) {
        console.log(`✅ [MailerPress Webhook] Sent successfully for ${normalizedEmail} (Lists: [${listArray.join(', ')}], Tag: "${primaryTag}", Event: ${event})`);
        return true;
      } else {
        const errText = await jsonResponse.text().catch(() => '');
        console.warn(`⚠️ [MailerPress Webhook] JSON POST attempt ${attempt} returned status ${jsonResponse.status}: ${errText}`);
      }
    } catch (err) {
      console.warn(`⚠️ [MailerPress Webhook] JSON POST attempt ${attempt} failed: ${err.message}`);
    }

    // Attempt 2: Form-urlencoded fallback
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const formResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: formData.toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (formResponse.ok) {
        console.log(`✅ [MailerPress Webhook] Form payload sent successfully for ${normalizedEmail} (Lists: [${listArray.join(', ')}], Tag: "${primaryTag}", Event: ${event})`);
        return true;
      }
    } catch (err) {
      console.warn(`⚠️ [MailerPress Webhook] Form POST attempt ${attempt} failed: ${err.message}`);
    }

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }

  return false;
}

// Alias for backwards compatibility
export const forwardToMailerpress = forwardToFluentCRM;

// ────────────────────────────────────────────────────────────
//  Shared Database-to-CRM Profile Resolver
// ────────────────────────────────────────────────────────────

/**
 * Fetch and build the complete CRM contact state from MySQL database tables
 * (reviewfic-userlogin / reviewfic-userlogin, payments, reviewfic_trials).
 */
export async function getUserCRMProfile(userLoginIdOrEmail) {
  let user = null;
  const isNumeric = typeof userLoginIdOrEmail === 'number' || (typeof userLoginIdOrEmail === 'string' && /^\d+$/.test(userLoginIdOrEmail));

  if (isNumeric) {
    const userIdNum = Number(userLoginIdOrEmail);
    try {
      const [ffUsers] = await db.query(
        'SELECT id, username, email, framer_site_name, framer_site_url, plan, subscription_status, payment_status FROM `reviewfic-userlogin` WHERE id = ? LIMIT 1',
        [userIdNum]
      );
      if (ffUsers && ffUsers.length > 0) user = ffUsers[0];
    } catch (e) {}
  } else if (typeof userLoginIdOrEmail === 'string' && userLoginIdOrEmail.includes('@')) {
    const normalizedInputEmail = userLoginIdOrEmail.toLowerCase().trim();
    try {
      const [ffUsers] = await db.query(
        'SELECT id, username, email, framer_site_name, framer_site_url, plan, subscription_status, payment_status FROM `reviewfic-userlogin` WHERE LOWER(TRIM(email)) = ? LIMIT 1',
        [normalizedInputEmail]
      );
      if (ffUsers && ffUsers.length > 0) user = ffUsers[0];
    } catch (e) {}

    if (!user) {
      user = {
        id: null,
        username: normalizedInputEmail.split('@')[0],
        email: normalizedInputEmail,
        framer_site_name: null,
        framer_site_url: null,
        plan: null,
        subscription_status: null,
        payment_status: null,
      };
    }
  }

  if (!user || !user.email) return null;
  const normalizedUserEmail = user.email.toLowerCase().trim();

  let siteName = user.framer_site_name || null;
  let siteUrl = user.framer_site_url || null;

  // 1️⃣ Fetch ALL payment records for this user (to determine purchase / renewal history)
  let paymentWhere = 'WHERE LOWER(TRIM(email)) = ?';
  const paymentParams = [normalizedUserEmail];
  if (user.id && Number.isInteger(Number(user.id)) && Number(user.id) > 0) {
    paymentWhere = 'WHERE (user_login_id = ? OR LOWER(TRIM(email)) = ?)';
    paymentParams.unshift(Number(user.id));
  }

  let payments = [];
  try {
    const [rows] = await db.query(
      `SELECT id, status, plan, expires_at, site_name, site_url, amount, currency, stripe_subscription_id, created_at, username FROM payments 
       ${paymentWhere} AND status IS NOT NULL 
       ORDER BY id DESC`,
      paymentParams
    );
    payments = rows || [];
  } catch (payErr) {
    console.warn('⚠️ Payments query warning:', payErr.message);
  }

  // 2️⃣ Fetch trial record from reviewfic_trials
  let trial = null;
  try {
    const [trials] = await db.query(
      `SELECT trial_start, trial_end, current_plan_status, site_name, site_url FROM reviewfic_trials
       WHERE LOWER(TRIM(email)) = ? ORDER BY id DESC LIMIT 1`,
      [normalizedUserEmail]
    );
    trial = trials[0] || null;
  } catch (trialErr) {
    console.warn('⚠️ Trials query warning:', trialErr.message);
  }

  if (trial) {
    if (!siteName && trial.site_name) siteName = trial.site_name;
    if (!siteUrl && trial.site_url) siteUrl = trial.site_url;
  }

  const latestPayment = payments[0] || null;
  if (latestPayment) {
    if (!siteName && latestPayment.site_name) siteName = latestPayment.site_name;
    if (!siteUrl && latestPayment.site_url) siteUrl = latestPayment.site_url;
  }

  if (!user.username) {
    if (latestPayment?.username) {
      user.username = latestPayment.username;
    } else if (trial?.site_name) {
      user.username = trial.site_name;
    } else {
      user.username = normalizedUserEmail.split('@')[0];
    }
  }

  const { firstName: resolvedFirstName, lastName: resolvedLastName, fullName } = resolveNames(user.username, '', '', normalizedUserEmail);
  user.firstName = resolvedFirstName;
  user.lastName = resolvedLastName;
  user.fullName = fullName;

  // Milestone determinations
  const successfulPayments = payments.filter(p => ['active', 'completed', 'paid', 'succeeded'].includes((p.status || '').toLowerCase()));
  const hasEverPaid = successfulPayments.length > 0;
  const hasMultiplePaid = successfulPayments.length > 1;

  const hasTrial = !!trial;
  const isTrialExpired = trial ? ((trial.trial_end && new Date(trial.trial_end).getTime() < Date.now()) || trial.current_plan_status === 'expired') : false;

  let planName = hasEverPaid ? (latestPayment?.plan || user.plan || successfulPayments[0]?.plan) : null;
  let currentPaymentStatus = 'signed_up';
  let primaryTag = 'Signup Users';

  if (hasEverPaid) {
    const statusLower = (latestPayment?.status || user.payment_status || '').toLowerCase();
    const isPaymentExpired = latestPayment?.expires_at ? new Date(latestPayment.expires_at).getTime() < Date.now() : false;

    if (['active', 'completed', 'paid', 'succeeded'].includes(statusLower) && !isPaymentExpired) {
      currentPaymentStatus = 'paid';
      primaryTag = hasMultiplePaid ? 'Renewed Users' : 'Paid Users';
    } else if (statusLower.includes('cancel') || ['cancelled', 'canceled', 'scheduled to cancel', 'canceling', 'unpaid'].includes(statusLower)) {
      currentPaymentStatus = 'cancelled';
      primaryTag = 'Cancelled Users';
    } else if (['past_due', 'failed', 'payment_failed', 'incomplete', 'incomplete_expired'].includes(statusLower)) {
      currentPaymentStatus = 'failed';
      primaryTag = 'Payment Failed';
    } else if (isPaymentExpired) {
      currentPaymentStatus = 'expired';
      primaryTag = 'Paid Users';
    } else {
      currentPaymentStatus = 'paid';
      primaryTag = hasMultiplePaid ? 'Renewed Users' : 'Paid Users';
    }
  } else if (hasTrial) {
    if (isTrialExpired) {
      currentPaymentStatus = 'expired';
      primaryTag = 'Trial Expired';
    } else {
      currentPaymentStatus = 'trialing';
      primaryTag = 'Trial Users';
    }
  } else {
    currentPaymentStatus = 'signed_up';
    primaryTag = 'Signup Users';
  }

  const listArray = ['App Users', 'Reviewfic'];

  return {
    user,
    siteName,
    siteUrl,
    list: 'App Users',
    lists: listArray,
    listArray,
    tags: [primaryTag],
    tagArray: [primaryTag],
    primaryTag,
    plan: planName,
    paymentStatus: currentPaymentStatus,
  };
}

// ────────────────────────────────────────────────────────────
//  User Sync Functions
// ────────────────────────────────────────────────────────────

/**
 * Synchronize user status from database to CRMfic.
 */
export async function syncUserToCRMfic(userLoginIdOrEmail, eventType = 'user_updated') {
  try {
    const profile = await getUserCRMProfile(userLoginIdOrEmail);
    if (!profile) return false;

    const ok = await forwardToCRMfic({
      email: profile.user.email,
      username: profile.user.username,
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      list: profile.lists,
      tags: profile.tags,
      plan: profile.plan,
      paymentStatus: profile.paymentStatus,
      siteName: profile.siteName,
      siteUrl: profile.siteUrl,
      event: eventType,
    });

    if (ok && profile.user.email) {
      await markContactAsCRMficSynced(profile.user.email);
    }
    return ok;
  } catch (err) {
    console.error('⚠️ [CRMfic Webhook] Error in syncUserToCRMfic:', err.message);
    return false;
  }
}

/**
 * Synchronize user to MailerPress / FluentCRM.
 */
export async function syncUserToFluentCRM(userLoginIdOrEmail, eventType = 'user_synced') {
  try {
    const profile = await getUserCRMProfile(userLoginIdOrEmail);
    if (!profile) return false;

    return await forwardToFluentCRM({
      email: profile.user.email,
      username: profile.user.username,
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      list: profile.lists,
      tags: profile.tags,
      plan: profile.plan,
      paymentStatus: profile.paymentStatus,
      siteName: profile.siteName,
      siteUrl: profile.siteUrl,
      event: eventType,
    });
  } catch (err) {
    console.error('⚠️ [MailerPress Webhook] Error in syncUserToFluentCRM:', err.message);
    return false;
  }
}

export const syncUserToMailerpress = syncUserToFluentCRM;

/**
 * Synchronize user status from database to BOTH CRMfic and MailerPress simultaneously.
 */
export async function syncUserToAllCRMs(userLoginIdOrEmail, eventType = 'user_updated') {
  try {
    const profile = await getUserCRMProfile(userLoginIdOrEmail);
    if (!profile) return { crmfic: false, fluentcrm: false, mailerpress: false };

    const payload = {
      email: profile.user.email,
      username: profile.user.username,
      firstName: profile.user.firstName,
      lastName: profile.user.lastName,
      list: profile.lists,
      tags: profile.tags,
      plan: profile.plan,
      paymentStatus: profile.paymentStatus,
      siteName: profile.siteName,
      siteUrl: profile.siteUrl,
      event: eventType,
    };

    const [crmficResult, mailerpressResult] = await Promise.allSettled([
      forwardToCRMfic(payload),
      forwardToFluentCRM(payload),
    ]);

    const crmficOk = crmficResult.status === 'fulfilled' ? crmficResult.value : false;
    const mailerpressOk = mailerpressResult.status === 'fulfilled' ? mailerpressResult.value : false;

    if (crmficOk && profile.user.email) {
      await markContactAsCRMficSynced(profile.user.email);
    }

    return {
      crmfic: crmficOk,
      fluentcrm: mailerpressOk,
      mailerpress: mailerpressOk,
    };
  } catch (err) {
    console.error('⚠️ [CRM Sync Engine] Error in syncUserToAllCRMs:', err.message);
    return { crmfic: false, fluentcrm: false, mailerpress: false };
  }
}

// ────────────────────────────────────────────────────────────
//  Delivery Status Tracking & Auto-Reconciliation Engine
// ────────────────────────────────────────────────────────────

/**
 * Mark a contact as successfully synchronized to CRMfic across all tables.
 */
export async function markContactAsCRMficSynced(email) {
  if (!email) return false;
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await Promise.allSettled([
      db.query('UPDATE reviewfic_trials SET crmfic_synced = 1, crmfic_synced_at = ? WHERE LOWER(TRIM(email)) = ?', [now, normalizedEmail]),
            db.query('UPDATE `reviewfic-userlogin` SET crmfic_synced = 1, crmfic_synced_at = ? WHERE LOWER(TRIM(email)) = ?', [now, normalizedEmail]),
      db.query('UPDATE payments SET crmfic_synced = 1, crmfic_synced_at = ? WHERE LOWER(TRIM(email)) = ?', [now, normalizedEmail]),
    ]);
    return true;
  } catch (err) {
    console.warn(`⚠️ Error marking ${normalizedEmail} as crmfic_synced:`, err.message);
    return false;
  }
}

/**
 * Gather unified unique contacts across reviewfic-userlogin, reviewfic-userlogin, reviewfic_trials, and payments.
 */
export async function getAllDBContacts({ unsyncedOnly = false, limit = null } = {}) {
  try {
    let query = `
      SELECT 
        email,
        MAX(username) AS username,
        MAX(site_name) AS site_name,
        MAX(site_url) AS site_url,
        MIN(crmfic_synced) AS crmfic_synced,
        MAX(last_active) AS last_active
      FROM (
        SELECT 
          LOWER(TRIM(email)) AS email, 
          username, 
          framer_site_name AS site_name, 
          framer_site_url AS site_url, 
          COALESCE(crmfic_synced, 0) AS crmfic_synced, 
          COALESCE(updated_at, created_at) AS last_active
        FROM \`reviewfic-userlogin\`
        WHERE email IS NOT NULL AND TRIM(email) != ''
        
        UNION ALL
        
        SELECT 
          LOWER(TRIM(email)) AS email, 
          username, 
          framer_site_name AS site_name, 
          framer_site_url AS site_url, 
          COALESCE(crmfic_synced, 0) AS crmfic_synced, 
          COALESCE(updated_at, created_at) AS last_active
        FROM \`reviewfic-userlogin\`
        WHERE email IS NOT NULL AND TRIM(email) != ''
        
        UNION ALL
        
        SELECT 
          LOWER(TRIM(email)) AS email, 
          NULL AS username, 
          site_name, 
          site_url, 
          COALESCE(crmfic_synced, 0) AS crmfic_synced, 
          trial_start AS last_active
        FROM reviewfic_trials
        WHERE email IS NOT NULL AND TRIM(email) != ''
        
        UNION ALL
        
        SELECT 
          LOWER(TRIM(email)) AS email, 
          username, 
          site_name, 
          site_url, 
          COALESCE(crmfic_synced, 0) AS crmfic_synced, 
          created_at AS last_active
        FROM payments
        WHERE email IS NOT NULL AND TRIM(email) != ''
      ) AS unified_contacts
      GROUP BY email
    `;

    if (unsyncedOnly) {
      query += ' HAVING MIN(crmfic_synced) = 0';
    }

    query += ' ORDER BY last_active DESC';

    if (limit && Number.isInteger(limit) && limit > 0) {
      query += ` LIMIT ${limit}`;
    }

    const [rows] = await db.query(query);
    return rows || [];
  } catch (err) {
    if (err.message && err.message.includes("Unknown column 'crmfic_synced'")) {
      try {
        let fallbackQuery = `
          SELECT email, MAX(username) as username, MAX(site_name) as site_name, MAX(site_url) as site_url, 0 as crmfic_synced
          FROM (
            SELECT LOWER(TRIM(email)) as email, username, framer_site_name AS site_name, framer_site_url AS site_url FROM \`reviewfic-userlogin\` WHERE email IS NOT NULL AND TRIM(email) != ''
            UNION ALL
            SELECT LOWER(TRIM(email)) as email, NULL AS username, site_name, site_url FROM reviewfic_trials WHERE email IS NOT NULL AND TRIM(email) != ''
            UNION ALL
            SELECT LOWER(TRIM(email)) as email, username, site_name, site_url FROM payments WHERE email IS NOT NULL AND TRIM(email) != ''
          ) AS fallback_contacts
          GROUP BY email
        `;
        if (limit && Number.isInteger(limit) && limit > 0) {
          fallbackQuery += ` LIMIT ${limit}`;
        }
        const [rows] = await db.query(fallbackQuery);
        return rows || [];
      } catch (fbErr) {
        console.error('❌ Error in getAllDBContacts fallback:', fbErr.message);
        return [];
      }
    }
    console.error('❌ Error in getAllDBContacts:', err.message);
    return [];
  }
}

/**
 * Retrieve contacts that have missed or not yet been transferred to CRMfic.
 */
export async function getMissedCRMficContacts(limit = null) {
  const rows = await getAllDBContacts({ unsyncedOnly: true, limit });
  const enriched = [];

  for (const row of rows) {
    const email = (row.email || '').toLowerCase().trim();
    if (!email) continue;

    try {
      const profile = await getUserCRMProfile(email);
      enriched.push({
        email,
        username: profile?.user?.username || row.username || email.split('@')[0],
        firstName: profile?.user?.firstName || '',
        lastName: profile?.user?.lastName || '',
        crmfic_synced: Number(row.crmfic_synced),
        last_active: row.last_active,
        status: profile?.paymentStatus || 'unknown',
        plan: profile?.plan || null,
        lists: ['App Users', 'Reviewfic'],
        primaryList: 'App Users',
        tags: profile?.tags || ['Signup Users'],
        primaryTag: profile?.primaryTag || 'Signup Users',
        siteName: profile?.siteName || row.site_name || null,
        siteUrl: profile?.siteUrl || row.site_url || null,
      });
    } catch (err) {
      enriched.push({
        email,
        username: row.username || email.split('@')[0],
        crmfic_synced: Number(row.crmfic_synced),
        last_active: row.last_active,
        error: err.message,
      });
    }
  }

  return enriched;
}

let isAutoSyncRunning = false;
let lastAutoSyncReport = {
  lastRunAt: null,
  totalFound: 0,
  syncedCount: 0,
  failedCount: 0,
  durationMs: 0,
};

/**
 * Automatically inspects the database for missed contacts, builds profiles, pushes to CRMfic, and marks synced.
 */
export async function autoSyncMissedContactsToCRMfic({ limit = 100, forceAll = false } = {}) {
  if (isAutoSyncRunning) {
    console.log('⏳ [CRMfic Auto-Sync] Reconciliation already in progress, skipping duplicate run.');
    return { skipped: true, reason: 'Already in progress' };
  }

  isAutoSyncRunning = true;
  const startTime = Date.now();

  try {
    const contacts = await getAllDBContacts({ unsyncedOnly: !forceAll, limit });
    if (!contacts || contacts.length === 0) {
      lastAutoSyncReport = {
        lastRunAt: new Date().toISOString(),
        totalFound: 0,
        syncedCount: 0,
        failedCount: 0,
        durationMs: Date.now() - startTime,
      };
      return { totalFound: 0, syncedCount: 0, failedCount: 0, durationMs: Date.now() - startTime };
    }

    console.log(`\n🔄 [CRMfic Auto-Sync] Found ${contacts.length} ${forceAll ? 'total' : 'missed/unsynced'} contact(s) to transfer.`);

    let syncedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const email = (contact.email || '').toLowerCase().trim();
      if (!email) continue;

      try {
        const profile = await getUserCRMProfile(email);
        if (!profile) {
          failedCount++;
          continue;
        }

        const payload = {
          email: profile.user.email,
          username: profile.user.username || contact.username || email.split('@')[0],
          firstName: profile.user.firstName || '',
          lastName: profile.user.lastName || '',
          list: profile.lists,
          tags: profile.tags,
          plan: profile.plan,
          paymentStatus: profile.paymentStatus,
          siteName: profile.siteName || contact.site_name,
          siteUrl: profile.siteUrl || contact.site_url,
          event: forceAll ? 'cli_bulk_sync' : 'auto_reconciliation_sync',
        };

        const success = await forwardToCRMfic(payload);
        if (success) {
          await markContactAsCRMficSynced(email);
          syncedCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        console.warn(`⚠️ [CRMfic Auto-Sync] Error syncing ${email}:`, err.message);
        failedCount++;
      }

      // 100ms pause to respect remote webhook rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    lastAutoSyncReport = {
      lastRunAt: new Date().toISOString(),
      totalFound: contacts.length,
      syncedCount,
      failedCount,
      durationMs: Date.now() - startTime,
    };

    console.log(`✅ [CRMfic Auto-Sync] Completed: ${syncedCount} synced, ${failedCount} failed (${Date.now() - startTime}ms)\n`);

    return {
      totalFound: contacts.length,
      syncedCount,
      failedCount,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('❌ [CRMfic Auto-Sync] Error during auto-sync:', err.message);
    return { error: err.message };
  } finally {
    isAutoSyncRunning = false;
  }
}

/**
 * Return current sync metrics across database and CRMfic.
 */
export async function getCRMficSyncStats() {
  try {
    const allContacts = await getAllDBContacts({ unsyncedOnly: false });
    const totalCount = allContacts.length;
    const syncedCount = allContacts.filter(c => Number(c.crmfic_synced) === 1).length;
    const unsyncedCount = totalCount - syncedCount;

    return {
      totalContacts: totalCount,
      syncedCount,
      unsyncedCount,
      isAutoSyncRunning,
      lastAutoSyncReport,
      autoSyncIntervalMinutes: parseInt(process.env.CRMFIC_AUTO_SYNC_INTERVAL_MINUTES, 10) || 10,
      webhookUrl: process.env.CRMFIC_WEBHOOK_URL || DEFAULT_CRMFIC_WEBHOOK_URL,
    };
  } catch (err) {
    console.error('❌ Error getting CRMfic sync stats:', err.message);
    return { error: err.message };
  }
}

export default {
  forwardToCRMfic,
  forwardToFluentCRM,
  forwardToMailerpress,
  getUserCRMProfile,
  syncUserToCRMfic,
  syncUserToFluentCRM,
  syncUserToMailerpress,
  syncUserToAllCRMs,
  markContactAsCRMficSynced,
  getAllDBContacts,
  getMissedCRMficContacts,
  autoSyncMissedContactsToCRMfic,
  getCRMficSyncStats,
  resolveLifecycleTag,
  resolveListsAndTags,
};
