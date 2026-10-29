import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import {
  forwardToCRMfic,
  forwardToFluentCRM,
  syncUserToAllCRMs,
  syncUserToCRMfic,
  syncUserToFluentCRM,
} from './webhookcrm.js';

export {
  forwardToCRMfic,
  forwardToFluentCRM,
  syncUserToAllCRMs,
  syncUserToCRMfic,
  syncUserToFluentCRM,
};

import { renderAuthPageHtml } from './authPage.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let faviconBase64 = '';
try {
  const iconSvgPath = path.join(__dirname, 'assets', 'icon.svg');
  if (existsSync(iconSvgPath)) {
    const iconBuffer = readFileSync(iconSvgPath);
    faviconBase64 = `data:image/svg+xml;base64,${iconBuffer.toString('base64')}`;
  } else {
    const faviconBuffer = readFileSync(path.join(__dirname, 'assets', 'Favicon.png'));
    faviconBase64 = `data:image/png;base64,${faviconBuffer.toString('base64')}`;
  }
} catch (e) {
  faviconBase64 = '';
}

// ────────────────────────────────────────────────────────────
//  Shared Authentication Stores
// ────────────────────────────────────────────────────────────
export const resetCodeStore = new Map();
export const signupCodeStore = new Map();
export const loginOtpStore = new Map();
export const socialAuthSessions = new Map();
export const pendingOAuthCodeExchanges = new Map();
export const socialSessionMetadata = new Map();

const JWT_SECRET = process.env.JWT_SECRET || 'framefic-reviewfic-secret-key-change-in-production';
const BCRYPT_SALT_ROUNDS = 12;

function generateResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

let teamSignupNotifier = null;
export function setTeamSignupNotifier(fn) {
  teamSignupNotifier = fn;
}

export function triggerTeamSignupNotification(params) {
  if (typeof teamSignupNotifier === 'function') {
    teamSignupNotifier(params).catch(err => console.error('⚠️ Error sending team signup email:', err.message));
  }
}

let signupVerificationNotifier = null;
export function setSignupVerificationNotifier(fn) {
  signupVerificationNotifier = fn;
}

export async function triggerSignupVerificationEmail(params) {
  if (typeof signupVerificationNotifier === 'function') {
    try {
      return await signupVerificationNotifier(params);
    } catch (err) {
      console.error('⚠️ Error sending verification email:', err.message);
      return false;
    }
  }
  return false;
}

let passwordResetNotifier = null;
export function setPasswordResetNotifier(fn) {
  passwordResetNotifier = fn;
}

export async function triggerPasswordResetEmail(params) {
  if (typeof passwordResetNotifier === 'function') {
    try {
      return await passwordResetNotifier(params);
    } catch (err) {
      console.error('⚠️ Error sending password reset email:', err.message);
      return false;
    }
  }
  return false;
}

let trialStarter = null;
export function setTrialStarter(fn) {
  trialStarter = fn;
}

export function getTrialDuration() {
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

export function calculateTrialEnd(startDate) {
  const duration = getTrialDuration();
  const end = new Date(startDate);
  if (duration.unit === 'minute') {
    end.setMinutes(end.getMinutes() + duration.value);
  } else {
    end.setDate(end.getDate() + duration.value);
  }
  return end;
}

export function getTrialDurationLabel() {
  const duration = getTrialDuration();
  if (duration.unit === 'minute') {
    return `${duration.value}-${duration.value === 1 ? 'Minute' : 'Minute'}`;
  }
  return `${duration.value}-${duration.value === 1 ? 'Day' : 'Day'}`;
}

export async function ensureUserTrial(email, siteId = 'framer-cloud', framerUserId = null, siteName = null, siteUrl = null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  try {
    // 1. Check existing trial in reviewfic_trials
    const [existing] = await db.query(
      `SELECT id, email, site_id, framer_user_id, site_name, site_url, trial_start, trial_end, current_plan_status,
              DATE_FORMAT(trial_start, '%Y-%m-%dT%H:%i:%sZ') as trial_start_utc, 
              DATE_FORMAT(trial_end, '%Y-%m-%dT%H:%i:%sZ') as trial_end_utc
       FROM reviewfic_trials
       WHERE LOWER(TRIM(email)) = ?
       ORDER BY id DESC LIMIT 1`,
      [normalizedEmail]
    );

    if (existing.length > 0) {
      const trial = existing[0];
      const needsSiteIdUpdate = (trial.site_id === 'framer-cloud' || trial.site_id === 'unknown' || !trial.site_id) && siteId && siteId !== 'framer-cloud' && siteId !== 'unknown';
      const needsUserUpdate = !trial.framer_user_id && framerUserId;
      const needsSiteNameUpdate = !trial.site_name && siteName;
      const needsSiteUrlUpdate = !trial.site_url && siteUrl;

      if (needsSiteIdUpdate || needsUserUpdate || needsSiteNameUpdate || needsSiteUrlUpdate) {
        await db.query(
          `UPDATE reviewfic_trials
           SET site_id = CASE WHEN site_id IN ('framer-cloud', 'unknown', '') AND ? IS NOT NULL AND ? NOT IN ('framer-cloud', 'unknown', '') THEN ? ELSE site_id END,
               framer_user_id = COALESCE(?, framer_user_id),
               site_name = COALESCE(?, site_name),
               site_url = COALESCE(?, site_url)
           WHERE id = ?`,
          [siteId, siteId, siteId, framerUserId, siteName, siteUrl, trial.id]
        );
      }

      const now = new Date();
      const trialEnd = new Date(trial.trial_end_utc || trial.trial_end);
      const isStillActive = trialEnd > now;
      const secondsRemaining = Math.max(0, Math.floor((trialEnd - now) / 1000));
      const daysRemaining = Math.ceil(secondsRemaining / (24 * 3600));

      return {
        isTrial: isStillActive,
        status: isStillActive ? 'trialing' : 'expired',
        trialEndsAt: trial.trial_end_utc || trial.trial_end,
        trialSecondsRemaining: secondsRemaining,
        trialDaysRemaining: daysRemaining,
      };
    }

    // 2. Start new 7-day trial using trialStarter if provided
    if (typeof trialStarter === 'function') {
      try {
        const result = await trialStarter(normalizedEmail, siteId, framerUserId, 0, siteName, siteUrl);
        if (result && result.success) {
          const trialEnd = new Date(result.trialEnd);
          const secondsRemaining = Math.max(0, Math.floor((trialEnd - Date.now()) / 1000));
          return {
            isTrial: true,
            status: 'trialing',
            trialEndsAt: result.trialEnd,
            trialSecondsRemaining: secondsRemaining,
            trialDaysRemaining: Math.ceil(secondsRemaining / (24 * 3600)),
          };
        }
      } catch (tsErr) {
        console.warn('⚠️ trialStarter hook failed, falling back to direct DB insert:', tsErr.message);
      }
    }

    // 3. Direct DB fallback insertion respecting TRIAL_DURATION_MINUTES / TRIAL_DURATION_DAYS
    const trialStart = new Date();
    const trialEnd = calculateTrialEnd(trialStart);
    const trialStartStr = trialStart.toISOString().slice(0, 19).replace('T', ' ');
    const trialEndStr = trialEnd.toISOString().slice(0, 19).replace('T', ' ');
    const secondsRemaining = Math.max(0, Math.floor((trialEnd - trialStart) / 1000));
    const daysRemaining = Math.max(0, Math.ceil(secondsRemaining / (24 * 3600)));

    await db.query(
      `INSERT INTO reviewfic_trials (email, site_id, site_name, site_url, framer_user_id, trial_start, trial_end, components_added, current_plan_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'trialing')`,
      [normalizedEmail, siteId, siteName, siteUrl, framerUserId, trialStartStr, trialEndStr]
    );

    syncUserToAllCRMs(normalizedEmail, 'TRIAL_STARTED').catch(err => {
      console.warn('⚠️ [CRM Webhook] Trial start sync error:', err.message);
    });

    return {
      isTrial: true,
      status: 'trialing',
      trialEndsAt: trialEndStr,
      trialSecondsRemaining: secondsRemaining,
      trialDaysRemaining: daysRemaining,
    };
  } catch (err) {
    console.error('⚠️ ensureUserTrial error:', err.message);
    return null;
  }
}

export async function forwardToUserWebhook(data) {
  try {
    const {
      email,
      name,
      username,
      first_name,
      last_name,
      siteName,
      siteUrl,
      site_name,
      site_url,
      framer_site_name,
      framer_site_url,
      plan,
      status,
      lists,
      tags,
      source,
      event = 'signup',
    } = data || {};

    const resolvedEmail = (email || '').toLowerCase().trim();
    if (!resolvedEmail) return;

    const resolvedSiteName = siteName || site_name || framer_site_name || null;
    const resolvedSiteUrl = siteUrl || site_url || framer_site_url || null;

    const payload = {
      email: resolvedEmail,
      username: username || name || resolvedEmail.split('@')[0],
      firstName: first_name || '',
      lastName: last_name || '',
      name: name || '',
      status: status === 'subscribed' ? 'Subscribed' : (status || 'Subscribed'),
      list: ['App Users', 'Reviewfic'],
      tags: tags || ['Signup Users'],
      plan: plan || null,
      siteName: resolvedSiteName,
      siteUrl: resolvedSiteUrl,
      event: event || 'signup',
    };

    const [crmficRes, mailerpressRes] = await Promise.allSettled([
      forwardToCRMfic(payload),
      forwardToFluentCRM({
        ...payload,
        status: 'subscribed',
      }),
    ]);

    const crmficOk = crmficRes.status === 'fulfilled' && crmficRes.value;
    const mailerpressOk = mailerpressRes.status === 'fulfilled' && mailerpressRes.value;
    console.log(`📤 Pushed user ${resolvedEmail} to CRM webhooks (CRMfic: ${crmficOk ? '✅' : 'Skipped/Failed'}, MailerPress: ${mailerpressOk ? '✅' : 'Skipped/Failed'})`);
  } catch (err) {
    console.error('⚠️ User webhook forward failed:', err.message);
  }
}

// Serve Favicon PNG image endpoint (case-insensitive & favicon.ico)
router.get(['/assets/icon.svg', '/assets/Favicon.png', '/assets/favicon.png', '/assets/favicon.ico'], (req, res) => {
  const iconPath = path.join(__dirname, 'assets', 'icon.svg');
  if (existsSync(iconPath)) {
    return res.type('image/svg+xml').sendFile(iconPath);
  }
  const faviconPath = path.join(__dirname, 'assets', 'Favicon.png');
  res.sendFile(faviconPath);
});

// Serve Framefic PNG image endpoint (case-insensitive)
router.get(['/assets/Framefic.png', '/assets/framefic.png'], (req, res) => {
  const frameficPath = path.join(__dirname, 'assets', 'Framefic.png');
  res.sendFile(frameficPath);
});

// Statically serve all files in assets folder
router.use('/assets', express.static(path.join(__dirname, 'assets')));

// ────────────────────────────────────────────────────────────
//  GET /auth
//  Hosted External Authentication Portal (Matches Plugin UI)
// ────────────────────────────────────────────────────────────
router.get(['/auth', '/reviewfic/auth'], (req, res) => {
  const sessionId = req.query.sessionId || '';
  const initialMode = req.query.mode === 'register' ? 'register' : 'login';
  const prefix = (req.baseUrl && req.baseUrl.startsWith('/reviewfic'))
    || (req.originalUrl && req.originalUrl.startsWith('/reviewfic'))
    || (process.env.BACKEND_URL && process.env.BACKEND_URL.includes('/reviewfic'))
    ? '/reviewfic' : '';
  const theme = (req.query.theme || '').toLowerCase().trim();
  const siteId = req.query.siteId || '';
  const framerUserId = req.query.framerUserId || '';
  const siteName = req.query.siteName || '';
  const siteUrl = req.query.siteUrl || '';

  res.send(renderAuthPageHtml({
    sessionId,
    initialMode,
    prefix,
    theme,
    faviconBase64,
    siteId,
    framerUserId,
    siteName,
    siteUrl,
  }));
});

// Export helper for popup success response
export function sendSocialAuthSuccessMessage(res, token, user, sessionId = null, isRegister = false, trial = null, theme = '') {
  let shortCode = '';
  if (sessionId) {
    shortCode = String(Math.floor(100000 + Math.random() * 900000));
    const sessionData = { status: 'authenticated', token, user, trial };
    socialAuthSessions.set(sessionId, sessionData);
    socialAuthSessions.set(shortCode, sessionData);

    setTimeout(() => {
      socialAuthSessions.delete(sessionId);
      socialAuthSessions.delete(shortCode);
    }, 10 * 60 * 1000);
  }

  const iconHref = faviconBase64 || '/assets/Favicon.png';
  const isTrialActive = trial && trial.isTrial;
  const resolvedTheme = (theme || (res.req && res.req.query && res.req.query.theme) || '').toLowerCase().trim();
  const initialThemeClass = resolvedTheme === 'light' ? 'light-mode' : 'dark-mode';

  res.send(`
    <!DOCTYPE html>
    <html lang="en" class="${initialThemeClass}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Authenticated - Reviewfic</title>
      <link rel="icon" type="image/png" href="${iconHref}">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        
        :root {
          --bg-html: #000000;
          --bg-body: radial-gradient(1000px 560px at 50% -20px, #5271ff70 0%, rgb(112 138 255 / 21%) 50%, transparent 75%), radial-gradient(800px 480px at 50% 115%, rgb(82 113 255 / 63%) 0%, transparent 65%), #000000;
          --bg-card: rgba(16, 18, 27, 0.94);
          --border-card: rgba(255, 255, 255, 0.09);
          --text-primary: #ffffff;
          --text-secondary: #94a3b8;
          --shadow-card: 0 24px 60px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.12), 0 0 35px rgba(82, 113, 255, 0.06);
        }

        body.light-mode, html.light-mode {
          --bg-html: #fbfbfb;
          --bg-body: radial-gradient(1000px 560px at 50% -20px, #5271ff70 0%, rgb(112 138 255 / 21%) 50%, transparent 75%), radial-gradient(800px 480px at 50% 115%, rgb(82 113 255 / 63%) 0%, transparent 65%), #fbfbfb;
          --bg-card: rgba(255, 255, 255, 0.98);
          --border-card: rgba(0, 0, 0, 0.08);
          --text-primary: #0f172a;
          --text-secondary: #475569;
          --shadow-card: 0 20px 50px rgba(15, 23, 42, 0.08), 0 0 1px rgba(0, 0, 0, 0.04), 0 0 25px rgba(82, 113, 255, 0.05);
        }

        html {
          background-color: var(--bg-html);
          min-height: 100%;
        }

        body {
          background: var(--bg-body);
          background-attachment: fixed;
          background-repeat: no-repeat;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
          text-align: center;
          position: relative;
          overflow: hidden;
          transition: background 0.25s ease, color 0.25s ease;
        }

        .success-card {
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 20px;
          padding: 34px 28px;
          width: 100%;
          max-width: 360px;
          box-shadow: var(--shadow-card);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          position: relative;
          z-index: 10;
        }

        .icon-box {
          width: 56px;
          height: 56px;
          margin: 0 auto 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .icon-box img {
          width: 52px;
          height: 52px;
          border-radius: 12px;
          object-fit: contain;
          box-shadow: 0 4px 16px rgba(82, 113, 255, 0.25);
        }

        .title {
          font-size: 19px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 8px;
          letter-spacing: -0.01em;
        }

        .trial-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          background: rgba(34, 197, 94, 0.12);
          border: 1px solid rgba(34, 197, 94, 0.3);
          color: #22c55e;
          border-radius: 8px;
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 600;
          margin: 4px auto 14px;
        }

        .trial-pill svg {
          flex-shrink: 0;
        }

        .subtitle {
          font-size: 12.5px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin-bottom: 20px;
        }

        /* ── Return to Framer (Primary CTA) ── */
        .close-btn,
        .primary-cta {
          color: #ffffff !important;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 13px;
          font-style: normal;
          font-weight: 400 !important;
          width: 100%;
          letter-spacing: 0.22px;
          position: relative;
          z-index: 0;
          border: 2px solid transparent !important;
          background:
            linear-gradient(#5271FF, #5271FF) padding-box,
            linear-gradient(180deg, #708AFF 0%, #3358FF 100%) border-box !important;
          border-radius: 10px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          height: 36px;
          box-sizing: border-box;
          outline: none;
          transition: opacity 0.2s ease, transform 0.1s ease;
        }

        .close-btn:hover,
        .primary-cta:hover {
          opacity: 0.92;
        }

        .close-btn:active,
        .primary-cta:active {
          transform: scale(0.98);
        }

        .auto-close-note {
          font-size: 11.5px;
          color: var(--text-secondary);
          margin-top: 12px;
        }
      </style>
    </head>
    <body class="${initialThemeClass}">
      <div class="success-card">
        <div class="icon-box">
          <img src="${iconHref}" alt="Brand Favicon" />
        </div>
        <div class="title">Authentication Successful!</div>
        ${isTrialActive ? `
        <div class="trial-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>${getTrialDurationLabel()} Free Trial Activated</span>
        </div>` : ''}
        <div class="subtitle">Connected to Reviewfic in Framer. You can return to the editor.</div>
        ${shortCode ? `
        <div style="margin: 0 auto 16px; padding: 6px 14px; background: rgba(82, 113, 255, 0.08); border: 1px dashed rgba(82, 113, 255, 0.35); border-radius: 8px; display: inline-flex; align-items: center; gap: 8px;">
          <span style="font-size: 11.5px; color: var(--text-secondary);">Manual sync code:</span>
          <strong style="font-size: 13.5px; letter-spacing: 1.5px; color: var(--text-primary); font-family: monospace;">${shortCode}</strong>
        </div>` : ''}
        <button class="close-btn primary-cta" onclick="try{window.close();}catch(e){}; try{self.close();}catch(e){}; try{window.open('','_self',''); window.close();}catch(e){}">Return to Framer</button>
        <div class="auto-close-note">This window will close automatically in <span id="auto-close-countdown" style="font-weight:600; color:var(--text-primary);">2</span>s...</div>
      </div>

      <script>
        (function() {
          try {
            var params = new URLSearchParams(window.location.search);
            var t = (params.get('theme') || '${resolvedTheme}').toLowerCase().trim();
            var isLight = t === 'light';
            document.documentElement.classList.toggle('light-mode', isLight);
            document.documentElement.classList.toggle('dark-mode', !isLight);
            if (document.body) {
              document.body.classList.toggle('light-mode', isLight);
              document.body.classList.toggle('dark-mode', !isLight);
            }
          } catch (e) {}

          try {
            if (window.opener) {
              window.opener.postMessage({
                type: 'social-auth-success',
                token: '${token}',
                user: ${JSON.stringify(user)},
                trial: ${JSON.stringify(trial)}
              }, '*');
            }
          } catch (e) {}

          function closeTab() {
            try { window.close(); } catch(e) {}
            try { self.close(); } catch(e) {}
            try { window.open('', '_self', ''); window.close(); } catch(e) {}
          }

          var secondsLeft = 2;
          var countdownEl = document.getElementById('auto-close-countdown');
          var timer = setInterval(function() {
            secondsLeft--;
            if (countdownEl && secondsLeft >= 0) {
              countdownEl.textContent = secondsLeft;
            }
            if (secondsLeft <= 0) {
              clearInterval(timer);
              closeTab();
            }
          }, 1000);

          setTimeout(closeTab, 2400);
        })();
      </script>
    </body>
    </html>
  `);
}

// ────────────────────────────────────────────────────────────
//  GET /api/auth/account-exists
// ────────────────────────────────────────────────────────────
router.get('/api/auth/account-exists', async (req, res) => {
  try {
    const rawEmail = req.query.email;
    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const [rows] = await db.query(
      'SELECT id FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );

    return res.json({ exists: rows.length > 0 });
  } catch (err) {
    console.error('❌ Error checking account existence:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/send-signup-code
//  Passwordless login & registration verification code sender
// ────────────────────────────────────────────────────────────
router.post(['/api/auth/send-signup-code', '/send-signup-code'], async (req, res) => {
  try {
    const { username, email, isSignIn } = req.body;
    const resolvedEmail = normalizeEmail(email);

    if (!resolvedEmail) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    const resolvedUsername = typeof username === 'string' && username.trim()
      ? username.trim()
      : (resolvedEmail.split('@')[0] || 'there');

    const [rows] = await db.query(
      'SELECT id, username FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [resolvedEmail]
    );

    if (rows.length > 0 && !isSignIn) {
      return res.status(409).json({ message: 'An account with this email already exists. Please switch to Sign In.' });
    }

    if (rows.length === 0 && isSignIn) {
      return res.status(404).json({ message: 'No account found with this email. Please switch to Sign Up.' });
    }

    const finalUsername = rows.length > 0 ? (rows[0].username || resolvedUsername) : resolvedUsername;
    const code = generateResetCode();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
    signupCodeStore.set(resolvedEmail, { code, expiresAt, username: finalUsername });

    const emailSent = await triggerSignupVerificationEmail({ username: finalUsername, email: resolvedEmail, code });
    if (!emailSent) {
      console.warn(`⚠️ SMTP send issue for ${resolvedEmail}, code: ${code}`);
    }

    console.log(`📧 Verification code sent to ${resolvedEmail}`);
    return res.json({ success: true, message: 'Verification code has been sent to your email.' });
  } catch (err) {
    console.error('❌ Error sending signup verification code:', err);
    return res.status(500).json({ message: err.message || 'Failed to send verification code. Please try again.' });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/verify-signup-code
//  Passwordless verification & session completion
// ────────────────────────────────────────────────────────────
router.post(['/api/auth/verify-signup-code', '/verify-signup-code'], async (req, res) => {
  try {
    const { username, email, password, code, siteId, framerUserId, siteName, siteUrl, framerSiteName, framerSiteUrl, sessionId } = req.body;
    const finalSiteName = framerSiteName || siteName || null;
    const finalSiteUrl = framerSiteUrl || siteUrl || null;
    const resolvedEmail = normalizeEmail(email);

    if (!resolvedEmail || !code) {
      return res.status(400).json({ message: 'Email and 6-digit code are required.' });
    }

    const entry = signupCodeStore.get(resolvedEmail);
    if (!entry) {
      return res.status(400).json({ message: 'No verification code found. Please request a new code.' });
    }

    if (Date.now() > entry.expiresAt) {
      signupCodeStore.delete(resolvedEmail);
      return res.status(400).json({ message: 'Verification code has expired. Please request a new code.' });
    }

    if (entry.code !== String(code).trim()) {
      return res.status(400).json({ message: 'Incorrect 6-digit verification code. Please try again.' });
    }

    // Code verified successfully -> clear store
    signupCodeStore.delete(resolvedEmail);

    const resolvedUsername = (typeof username === 'string' && username.trim()) || entry.username || resolvedEmail.split('@')[0];

    // Check if user exists
    const [existing] = await db.query(
      'SELECT id, username, email, avatar_url, framer_site_name, framer_site_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [resolvedEmail]
    );

    let userId;
    let finalUsername = resolvedUsername;
    let avatarUrl = null;

    if (existing.length > 0) {
      userId = existing[0].id;
      finalUsername = existing[0].username || resolvedUsername;
      avatarUrl = existing[0].avatar_url || null;
      let updateSql = 'UPDATE `reviewfic-userlogin` SET is_verified = 1, framer_site_name = COALESCE(?, framer_site_name), framer_site_url = COALESCE(?, framer_site_url)';
      const updateParams = [finalSiteName, finalSiteUrl];
      if (password && typeof password === 'string' && password.trim().length >= 6) {
        const passwordHash = await bcrypt.hash(password.trim(), BCRYPT_SALT_ROUNDS);
        updateSql += ', password = COALESCE(password, ?)';
        updateParams.push(passwordHash);
      }
      updateSql += ' WHERE id = ?';
      updateParams.push(userId);
      await db.query(updateSql, updateParams);
    } else {
      // Create new verified user
      let passwordHash = null;
      if (password && typeof password === 'string' && password.trim().length >= 6) {
        passwordHash = await bcrypt.hash(password.trim(), BCRYPT_SALT_ROUNDS);
      }

      const [insertResult] = await db.query(
        'INSERT INTO `reviewfic-userlogin` (username, email, password, is_verified, framer_site_name, framer_site_url) VALUES (?, ?, ?, 1, ?, ?)',
        [resolvedUsername, resolvedEmail, passwordHash, finalSiteName, finalSiteUrl]
      );
      userId = insertResult.insertId;

      forwardToUserWebhook({
        email: resolvedEmail,
        name: resolvedUsername,
        source: passwordHash ? 'Reviewfic Email Signup' : 'Reviewfic Passwordless',
        tags: ['Signup Users'],
        lists: ['App Users', 'Reviewfic'],
        status: 'subscribed'
      }).catch(err => console.error('⚠️ Webhook error:', err.message));

      triggerTeamSignupNotification({
        username: resolvedUsername,
        email: resolvedEmail,
        source: passwordHash ? 'Email & Password Signup (Verified)' : 'Passwordless Email Code',
        userId,
        framerSiteName: finalSiteName,
        framerSiteUrl: finalSiteUrl,
      });
    }

    // Ensure 7-day trial in reviewfic_trials with full site telemetry
    const trial = await ensureUserTrial(resolvedEmail, siteId || 'framer-cloud', framerUserId, finalSiteName, finalSiteUrl);

    const token = jwt.sign(
      { userId, email: resolvedEmail, username: finalUsername },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const userObj = {
      id: userId,
      username: finalUsername,
      email: resolvedEmail,
      avatar_url: avatarUrl,
    };

    // If an ephemeral sessionId was passed, store it immediately in socialAuthSessions
    if (sessionId) {
      socialAuthSessions.set(sessionId, {
        status: 'authenticated',
        token,
        user: userObj,
        trial,
      });

      setTimeout(() => {
        socialAuthSessions.delete(sessionId);
      }, 10 * 60 * 1000);
    }

    return res.json({
      success: true,
      token,
      user: userObj,
      trial,
    });
  } catch (err) {
    console.error('❌ Error verifying code:', err);
    return res.status(500).json({ message: 'Verification failed. Please try again.' });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/forgot-password
//  Send a 6-digit reset code to the user's email.
// ────────────────────────────────────────────────────────────
router.post(['/api/auth/forgot-password', '/forgot-password'], async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const email = normalizeEmail(rawEmail);

    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    const [rows] = await db.query(
      'SELECT id, username FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No account found with this email. Please check your email or switch to Sign Up.' });
    }

    const rawUsername = rows[0]?.username;
    const userName = typeof rawUsername === 'string' && rawUsername.trim()
      ? rawUsername.trim()
      : (email.split('@')[0] || 'there');
    const code = generateResetCode();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
    resetCodeStore.set(email, { code, expiresAt, username: userName });

    await triggerPasswordResetEmail({ username: userName, email, code });

    console.log(`📧 Reset code sent to ${email}`);
    return res.json({ success: true, message: 'Password reset code has been sent to your email.' });
  } catch (err) {
    console.error('❌ Error sending reset code:', err);
    return res.status(500).json({ message: 'Failed to send reset code. Please try again.' });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/verify-reset-code
//  Verify the 6-digit code without resetting password yet.
// ────────────────────────────────────────────────────────────
router.post(['/api/auth/verify-reset-code', '/verify-reset-code'], async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const rawCode = req.body.code;
    const email = normalizeEmail(rawEmail);
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and 6-digit code are required.' });
    }

    const entry = resetCodeStore.get(email);
    if (!entry) {
      return res.status(400).json({ message: 'No reset code found. Please request a new code.' });
    }
    if (Date.now() > entry.expiresAt) {
      resetCodeStore.delete(email);
      return res.status(400).json({ message: 'Reset code has expired. Please request a new code.' });
    }
    if (entry.code !== code) {
      return res.status(400).json({ message: 'Incorrect 6-digit reset code. Please try again.' });
    }

    entry.verified = true;
    return res.json({ success: true, message: 'Code verified successfully.' });
  } catch (err) {
    console.error('❌ Error verifying reset code:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/reset-password
//  Reset the user's password after code verification.
// ────────────────────────────────────────────────────────────
router.post(['/api/auth/reset-password', '/reset-password'], async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const rawCode = req.body.code;
    const { newPassword, siteId, framerUserId, siteName, siteUrl, framerSiteName, framerSiteUrl, sessionId } = req.body;
    const finalSiteName = framerSiteName || siteName || null;
    const finalSiteUrl = framerSiteUrl || siteUrl || null;
    const email = normalizeEmail(rawEmail);
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code, and new password are required.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const entry = resetCodeStore.get(email);
    if (!entry) {
      return res.status(400).json({ message: 'Reset session not found. Please request a new code.' });
    }
    if (Date.now() > entry.expiresAt) {
      resetCodeStore.delete(email);
      return res.status(400).json({ message: 'Reset session expired. Please start over.' });
    }
    if (entry.code !== code) {
      return res.status(400).json({ message: 'Invalid 6-digit code.' });
    }

    const passwordHash = await bcrypt.hash(newPassword.trim(), BCRYPT_SALT_ROUNDS);
    const [result] = await db.query(
      'UPDATE `reviewfic-userlogin` SET password = ?, is_verified = 1, framer_site_name = COALESCE(?, framer_site_name), framer_site_url = COALESCE(?, framer_site_url) WHERE email = ?',
      [passwordHash, finalSiteName, finalSiteUrl, email]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    resetCodeStore.delete(email);
    console.log(`🔑 Password reset successfully for ${email}`);

    // Fetch user info to issue JWT and complete session
    const [userRows] = await db.query(
      'SELECT id, username, email, avatar_url FROM `reviewfic-userlogin` WHERE email = ? LIMIT 1',
      [email]
    );
    const user = userRows[0] || { id: null, username: entry.username || email.split('@')[0], email };

    const trial = await ensureUserTrial(email, siteId || 'framer-cloud', framerUserId, finalSiteName, finalSiteUrl);

    const token = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const userObj = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url || null,
    };

    if (sessionId) {
      socialAuthSessions.set(sessionId, {
        status: 'authenticated',
        token,
        user: userObj,
        trial,
      });

      setTimeout(() => {
        socialAuthSessions.delete(sessionId);
      }, 10 * 60 * 1000);
    }

    return res.json({
      success: true,
      message: 'Password reset successfully.',
      token,
      user: userObj,
      trial,
    });
  } catch (err) {
    console.error('❌ Error resetting password:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/register
// ────────────────────────────────────────────────────────────
router.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, siteId, framerUserId, siteName, siteUrl, framerSiteName, framerSiteUrl } = req.body;
    const finalSiteName = framerSiteName || siteName || null;
    const finalSiteUrl = framerSiteUrl || siteUrl || null;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const resolvedEmail = normalizeEmail(email);
    const resolvedUsername = (username && String(username).trim()) || resolvedEmail.split('@')[0];

    // Check if email already exists
    const [existing] = await db.query(
      'SELECT id FROM `reviewfic-userlogin` WHERE email = ?',
      [resolvedEmail]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists. Please switch to Sign In.' });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // Insert user
    const [result] = await db.query(
      'INSERT INTO `reviewfic-userlogin` (username, email, password, is_verified, framer_site_name, framer_site_url) VALUES (?, ?, ?, 0, ?, ?)',
      [resolvedUsername, resolvedEmail, passwordHash, finalSiteName, finalSiteUrl]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.insertId, email: resolvedEmail, username: resolvedUsername },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Forward new user to CRM webhook (non-blocking)
    forwardToUserWebhook({
      email: resolvedEmail,
      name: resolvedUsername,
      source: 'Reviewfic Email Signup',
      tags: ['Signup Users'],
      lists: ['App Users', 'Reviewfic'],
      status: 'subscribed'
    }).catch(err => console.error('⚠️ Failed to push email signup to webhook:', err.message));

    // Send team notification email to hello@framefic.com
    triggerTeamSignupNotification({
      username: resolvedUsername,
      email: resolvedEmail,
      source: 'Email Registration',
      userId: result.insertId,
      framerSiteName: finalSiteName,
      framerSiteUrl: finalSiteUrl,
    });

    // Ensure 7-day trial row in reviewfic_trials with full telemetry
    const trial = await ensureUserTrial(resolvedEmail, siteId || 'framer-cloud', framerUserId, finalSiteName, finalSiteUrl);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: result.insertId,
        username: resolvedUsername,
        email: resolvedEmail,
      },
      trial,
    });
  } catch (err) {
    console.error('❌ Error registering user:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/login
// ────────────────────────────────────────────────────────────
router.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, siteId, framerUserId, siteName, siteUrl, framerSiteName, framerSiteUrl } = req.body;
    const finalSiteName = framerSiteName || siteName || null;
    const finalSiteUrl = framerSiteUrl || siteUrl || null;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const resolvedEmail = normalizeEmail(email);

    const [users] = await db.query(
      'SELECT id, username, email, password, google_id, avatar_url FROM `reviewfic-userlogin` WHERE email = ?',
      [resolvedEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'No account found with this email. Please switch to Sign Up.' });
    }

    const user = users[0];

    if (!user.password && user.google_id) {
      return res.status(400).json({ message: 'This account was created with Google. Please click "Continue with Google".' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password || '');
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Incorrect password. Please check your password and try again.' });
    }

    if (finalSiteName || finalSiteUrl) {
      await db.query('UPDATE `reviewfic-userlogin` SET framer_site_name = COALESCE(?, framer_site_name), framer_site_url = COALESCE(?, framer_site_url) WHERE id = ?', [finalSiteName, finalSiteUrl, user.id]);
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Ensure/fetch trial status from reviewfic_trials with full telemetry
    const trial = await ensureUserTrial(user.email, siteId || 'framer-cloud', framerUserId, finalSiteName, finalSiteUrl);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
      },
      trial,
    });
  } catch (err) {
    console.error('❌ Error logging in user:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
//  Canonical Google OAuth Redirect URI
// ────────────────────────────────────────────────────────────
export const GOOGLE_REDIRECT_URI = 'https://app.framefic.com/reviewfic/api/auth/google/callback';

export function resolveGoogleRedirectUri() {
  return GOOGLE_REDIRECT_URI;
}

// ────────────────────────────────────────────────────────────
//  GET /api/auth/google
// ────────────────────────────────────────────────────────────
router.get('/api/auth/google', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = resolveGoogleRedirectUri(req);
  const sessionId = req.query.sessionId || '';
  const theme = (req.query.theme || '').toLowerCase().trim();
  const siteId = req.query.siteId || '';
  const framerUserId = req.query.framerUserId || '';
  const siteName = req.query.siteName || '';
  const siteUrl = req.query.siteUrl || '';

  if (sessionId) {
    socialAuthSessions.set(sessionId, {
      status: 'pending',
      siteId,
      framerUserId,
      siteName,
      siteUrl,
      theme,
    });
  }

  const statePayload = theme ? `${sessionId}::${theme}` : sessionId;

  if (!googleClientId || googleClientId.trim() === '' || googleClientId === 'your_google_client_id') {
    return renderMockLoginScreen(res, 'google', redirectUri, sessionId);
  }

  console.log(`🔑 [Google OAuth] Initiating redirect with redirectUri: ${redirectUri}`);

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(googleClientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=email%20profile` +
    `&prompt=select_account` +
    `&state=${encodeURIComponent(statePayload)}`;

  res.redirect(authUrl);
});

// ────────────────────────────────────────────────────────────
//  GET /api/auth/google/callback
// ────────────────────────────────────────────────────────────
router.get('/api/auth/google/callback', async (req, res) => {
  const { code, error, state } = req.query;
  let sessionId = state || null;
  let theme = '';
  if (state && state.includes('::')) {
    const parts = state.split('::');
    sessionId = parts[0] || null;
    theme = parts[1] || '';
  }
  if (error) {
    return res.status(400).send(`OAuth Error: ${error}`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  if (sessionId) {
    const existingSession = socialAuthSessions.get(sessionId);
    if (existingSession && existingSession.status === 'authenticated') {
      return sendSocialAuthSuccessMessage(res, existingSession.token, existingSession.user, sessionId, false, existingSession.trial || null, theme);
    }
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveGoogleRedirectUri(req);
  console.log(`🔑 [Google OAuth] Exchanging token with redirectUri: ${redirectUri}`);

  try {
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
    let avatarUrl = profile.picture || null;
    if (avatarUrl && avatarUrl.startsWith('http://')) {
      avatarUrl = avatarUrl.replace('http://', 'https://');
    }

    const pendingSession = sessionId ? socialAuthSessions.get(sessionId) : null;
    const siteId = pendingSession?.siteId || null;
    const framerUserId = pendingSession?.framerUserId || null;
    const siteName = pendingSession?.siteName || null;
    const siteUrl = pendingSession?.siteUrl || null;

    const result = await handleSocialUserSignup(email, username, googleId, null, avatarUrl, null, siteId, framerUserId, siteName, siteUrl);

    sendSocialAuthSuccessMessage(res, result.token, result.user, sessionId, result.isNewUser, result.trial, theme);
  } catch (err) {
    if (sessionId) {
      const existingSession = socialAuthSessions.get(sessionId);
      if (existingSession && existingSession.status === 'authenticated') {
        return sendSocialAuthSuccessMessage(res, existingSession.token, existingSession.user, sessionId, false, existingSession.trial || null, theme);
      }
    }
    console.error('❌ Google Callback Error:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/mock/callback
// ────────────────────────────────────────────────────────────
router.post('/api/auth/mock/callback', async (req, res) => {
  const { email, username, provider, state } = req.body;
  const sessionId = state || null;
  if (!email || !username) {
    return res.status(400).send('Email and Name are required for mock authentication.');
  }

  try {
    const resolvedEmail = email.toLowerCase().trim();
    const mockId = `mock-${provider}-${Date.now()}`;
    const googleId = provider === 'google' ? mockId : null;
    const avatarUrl = 'https://lh3.googleusercontent.com/a/default-user';

    const result = await handleSocialUserSignup(resolvedEmail, username, googleId, null, avatarUrl);

    sendSocialAuthSuccessMessage(res, result.token, result.user, sessionId, false, result.trial);
  } catch (err) {
    console.error('❌ Mock Callback Error:', err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// Helper: Handle Social User Signup/Signin logic
async function handleSocialUserSignup(email, username, googleId, facebookId, avatarUrl, microsoftId = null, siteId = null, framerUserId = null, siteName = null, siteUrl = null) {
  const [existing] = await db.query(
    'SELECT id, username, google_id, avatar_url FROM `reviewfic-userlogin` WHERE email = ?',
    [email]
  );

  let userId;
  let finalAvatarUrl = avatarUrl;
  let isNewUser = false;
  if (existing.length > 0) {
    userId = existing[0].id;
    finalAvatarUrl = existing[0].avatar_url || avatarUrl;
    if (googleId && !existing[0].google_id) {
      await db.query('UPDATE `reviewfic-userlogin` SET google_id = ?, is_verified = 1 WHERE id = ?', [googleId, userId]);
    } else {
      await db.query('UPDATE `reviewfic-userlogin` SET is_verified = 1 WHERE id = ?', [userId]);
    }
    if (avatarUrl && existing[0].avatar_url !== avatarUrl) {
      await db.query('UPDATE `reviewfic-userlogin` SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);
      finalAvatarUrl = avatarUrl;
    }
    if (siteName || siteUrl) {
      await db.query('UPDATE `reviewfic-userlogin` SET framer_site_name = COALESCE(?, framer_site_name), framer_site_url = COALESCE(?, framer_site_url) WHERE id = ?', [siteName, siteUrl, userId]);
    }
  } else {
    isNewUser = true;
    const [insertResult] = await db.query(
      'INSERT INTO `reviewfic-userlogin` (username, email, password, is_verified, google_id, avatar_url, framer_site_name, framer_site_url) VALUES (?, ?, NULL, 1, ?, ?, ?, ?)',
      [username, email, googleId, avatarUrl, siteName, siteUrl]
    );
    userId = insertResult.insertId;

    forwardToUserWebhook({
      email,
      name: username,
      source: googleId ? 'Reviewfic Google Signup' : 'Reviewfic Social Signup',
      tags: ['Signup Users'],
      lists: ['App Users', 'Reviewfic'],
      status: 'subscribed'
    }).catch(err => console.error('⚠️ Failed to push social signup to webhook:', err.message));

    triggerTeamSignupNotification({
      username,
      email,
      source: googleId ? 'Google OAuth Registration' : 'Social OAuth Registration',
      userId,
      framerSiteName: siteName,
      framerSiteUrl: siteUrl,
    });
  }

  // Ensure 7-day trial row in reviewfic_trials with full telemetry
  const trial = await ensureUserTrial(email, siteId || 'framer-cloud', framerUserId, siteName, siteUrl);

  const token = jwt.sign(
    { userId, email, username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  return {
    token,
    isNewUser,
    trial,
    user: {
      id: userId,
      username,
      email,
      avatar_url: finalAvatarUrl,
    }
  };
}

function renderMockLoginScreen(res, provider, redirectUri, sessionId = '') {
  const capitalizedProvider = provider.charAt(0).toUpperCase() + provider.slice(1);
  const color = '#4285F4';

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Developer Mock Social Auth</title>
      <style>
        body { margin: 0; font-family: 'Inter', -apple-system, sans-serif; background: #09090e; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .card { background: #13131c; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 32px; max-width: 400px; width: 90%; text-align: center; }
        .badge { background: rgba(234, 179, 8, 0.15); color: #FBBF24; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 16px; display: inline-block; }
        h2 { font-size: 18px; margin-bottom: 8px; }
        p { font-size: 12px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
        .form-group { margin-bottom: 14px; text-align: left; }
        label { display: block; font-size: 12px; font-weight: 500; color: #94a3b8; margin-bottom: 6px; }
        input { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: #09090e; color: #fff; font-size: 13px; box-sizing: border-box; }
        button { width: 100%; background: linear-gradient(180deg, #5271FF 0%, #004AAD 100%); color: white; border: none; padding: 11px; border-radius: 10px; font-weight: 600; font-size: 13.5px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="badge">Local Dev Mode</span>
        <h2>Simulate ${capitalizedProvider} Sign In</h2>
        <p>OAuth credentials missing in <code>.env</code>. Enter test details to proceed:</p>
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

// ────────────────────────────────────────────────────────────
//  GET /api/auth/me
// ────────────────────────────────────────────────────────────
router.get('/api/auth/me', async (req, res) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ message: 'No token provided.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const [users] = await db.query(
      'SELECT id, username, email, avatar_url FROM `reviewfic-userlogin` WHERE id = ?',
      [decoded.userId]
    );

    let user;
    if (users.length === 0) {
      if (decoded.email || decoded.userId) {
        user = {
          id: decoded.userId || 1,
          username: decoded.username || (decoded.email ? decoded.email.split('@')[0] : 'User'),
          email: decoded.email || 'user@example.com',
          avatar_url: null,
        };
      } else {
        return res.status(401).json({ message: 'User not found or session expired.' });
      }
    } else {
      user = {
        id: users[0].id,
        username: users[0].username,
        email: users[0].email,
        avatar_url: users[0].avatar_url,
      };
    }

    const siteId = req.query.siteId || null;
    const framerUserId = req.query.framerUserId || null;
    const siteName = req.query.siteName || null;
    const siteUrl = req.query.siteUrl || null;

    const trial = await ensureUserTrial(user.email, siteId || 'framer-cloud', framerUserId, siteName, siteUrl);

    if (req.query.sessionId) {
      const isRegister = req.query.isRegister === '1' || req.query.isRegister === 'true' || req.query.mode === 'register';
      const theme = (req.query.theme || '').toLowerCase().trim();
      return sendSocialAuthSuccessMessage(res, token, user, req.query.sessionId, isRegister, trial, theme);
    }

    res.json({
      success: true,
      user,
      trial,
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token.' });
    }
    console.error('❌ Error fetching user:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/auth/social-status
// ────────────────────────────────────────────────────────────
router.get('/api/auth/social-status', (req, res) => {
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
        user: session.user,
        trial: session.trial
      });
    }
  }

  return res.json({ status: 'pending' });
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/social-verify-code
// ────────────────────────────────────────────────────────────
router.post('/api/auth/social-verify-code', (req, res) => {
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
      user: session.user,
      trial: session.trial
    });
  }

  return res.status(400).json({ error: 'Invalid or expired code. Please try again.' });
});

export default router;
