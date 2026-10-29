/**
 * Renders the Hosted External Authentication Portal HTML.
 * Matches Framer plugin aesthetic with support for:
 * - Brand Favicon.png
 * - Automatic Light & Dark mode (via Framer theme parameter and prefers-color-scheme)
 * - Passwordless Sign-In (6-digit OTP verification code via email)
 * - 7-Day Free Trial Sign-Up registration
 * - Google Social OAuth
 * - Auto-close and session handshake pairing
 */
export function renderAuthPageHtml({ sessionId = '', initialMode = 'login', prefix = '', theme = '', faviconBase64 = '', siteId = '', framerUserId = '', siteName = '', siteUrl = '' }) {
  const telemetryQuery = (siteId ? `&siteId=${encodeURIComponent(siteId)}` : '') +
    (framerUserId ? `&framerUserId=${encodeURIComponent(framerUserId)}` : '') +
    (siteName ? `&siteName=${encodeURIComponent(siteName)}` : '') +
    (siteUrl ? `&siteUrl=${encodeURIComponent(siteUrl)}` : '');
  const defaultGoogleHref = `${prefix}/api/auth/google?sessionId=${encodeURIComponent(sessionId)}${initialMode === 'register' ? '&mode=register' : ''}${theme ? `&theme=${encodeURIComponent(theme)}` : ''}${telemetryQuery}`;
  const initialThemeClass = theme === 'light' ? 'light-mode' : 'dark-mode';
  const iconSrc = faviconBase64 || `${prefix}/assets/icon.svg`;

  return `<!DOCTYPE html>
<html lang="en" class="${initialThemeClass}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authenticate - Reviewfic</title>
  <link rel="icon" type="image/svg+xml" href="${iconSrc}">
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
      --text-muted: #64748b;
      --bg-input: #0b0c12;
      --border-input: rgba(255, 255, 255, 0.13);
      --border-input-focus: #5271FF;
      --text-input: #ffffff;
      --bg-tabs: #0b0c12;
      --border-tabs: rgba(255, 255, 255, 0.08);
      --bg-tab-active: #1e202f;
      --text-tab-active: #ffffff;
      --text-tab: #94a3b8;
      --divider-color: rgba(255, 255, 255, 0.08);
      --divider-text: #64748b;
      --social-btn-bg: #141622;
      --social-btn-bg-hover: #1a1e2e;
      --social-btn-text: #f1f5f9;
      --social-btn-border: rgba(255, 255, 255, 0.12);
      --social-btn-border-hover: rgba(82, 113, 255, 0.5);
      --social-btn-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      --social-btn-shadow-hover: 0 4px 14px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(82, 113, 255, 0.2);
      --card-shadow: 0 24px 60px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.12), 0 0 35px rgba(82, 113, 255, 0.06);
      --otp-banner-bg: rgba(82, 113, 255, 0.1);
      --otp-banner-border: rgba(82, 113, 255, 0.25);
      --otp-banner-text: #e2e8f0;
    }

    body.light-mode, html.light-mode {
      --bg-html: #fbfbfb;
      --bg-body: radial-gradient(1000px 560px at 50% -20px, #5271ff70 0%, rgb(112 138 255 / 21%) 50%, transparent 75%), radial-gradient(800px 480px at 50% 115%, rgb(82 113 255 / 63%) 0%, transparent 65%), #fbfbfb;
      --bg-card: rgba(255, 255, 255, 0.98);
      --border-card: rgba(0, 0, 0, 0.08);
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-muted: #64748b;
      --bg-input: #ffffff;
      --border-input: #cbd5e1;
      --border-input-focus: #5271FF;
      --text-input: #0f172a;
      --bg-tabs: #f1f5f9;
      --border-tabs: #e2e8f0;
      --bg-tab-active: #ffffff;
      --text-tab-active: #0f172a;
      --text-tab: #64748b;
      --divider-color: #e2e8f0;
      --divider-text: #94a3b8;
      --social-btn-bg: #ffffff;
      --social-btn-bg-hover: #f8fafc;
      --social-btn-text: #0f172a;
      --social-btn-border: #cbd5e1;
      --social-btn-border-hover: rgba(82, 113, 255, 0.45);
      --social-btn-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      --social-btn-shadow-hover: 0 4px 14px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(82, 113, 255, 0.18);
      --card-shadow: 0 20px 50px rgba(15, 23, 42, 0.08), 0 0 1px rgba(0, 0, 0, 0.04), 0 0 25px rgba(82, 113, 255, 0.05);
      --otp-banner-bg: rgba(82, 113, 255, 0.08);
      --otp-banner-border: rgba(82, 113, 255, 0.3);
      --otp-banner-text: #1e293b;
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
      position: relative;
      overflow-x: hidden;
      transition: background 0.25s ease, color 0.25s ease;
    }

    .auth-container {
      background: var(--bg-card);
      border: 1px solid var(--border-card);
      border-radius: 20px;
      padding: 34px 28px;
      width: 100%;
      max-width: 390px;
      box-shadow: var(--card-shadow);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      text-align: center;
      position: relative;
      z-index: 10;
      transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
    }

    .plugin-icon {
      width: 50px;
      height: 50px;
      margin: 0 auto 14px auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .plugin-icon img {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      object-fit: contain;
      display: block;
      box-shadow: 0 4px 16px rgba(82, 113, 255, 0.25);
    }

    .logo {
      font-size: 19px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }

    .subtitle {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 20px;
      line-height: 1.5;
    }

    /* ── Google Social Button ── */
    .social-btn-google {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--social-btn-border);
      background: var(--social-btn-bg);
      color: var(--social-btn-text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      box-shadow: var(--social-btn-shadow);
      margin-bottom: 16px;
      width: 100%;
      box-sizing: border-box;
      transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), color 0.18s ease;
    }

    .social-btn-google:hover {
      background: var(--social-btn-bg-hover);
      border-color: var(--social-btn-border-hover);
      box-shadow: var(--social-btn-shadow-hover);
      transform: translateY(-1px);
    }

    .social-btn-google:active {
      transform: translateY(0);
      box-shadow: var(--social-btn-shadow);
    }

    .social-btn-google svg {
      background: transparent;
      flex-shrink: 0;
    }

    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 16px 0 18px 0;
      color: var(--divider-text);
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--divider-color);
    }

    .tabs {
      display: flex;
      background: var(--bg-tabs);
      border-radius: 10px;
      padding: 4px;
      margin-bottom: 18px;
      border: 1px solid var(--border-tabs);
    }

    .tab {
      flex: 1;
      padding: 8px;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-tab);
      cursor: pointer;
      border-radius: 7px;
      transition: all 0.2s ease;
      border: none;
      background: transparent;
      font-family: inherit;
    }

    .tab.active {
      background: var(--bg-tab-active);
      color: var(--text-tab-active);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    }


    .form-group { margin-bottom: 14px; text-align: left; }
    label { display: block; font-size: 12px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
    
    .input-wrapper { position: relative; width: 100%; }

    input {
      width: 100%;
      padding: 10.5px 12px;
      border-radius: 10px;
      border: 1px solid var(--border-input);
      background: var(--bg-input);
      color: var(--text-input);
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    input:focus {
      border-color: var(--border-input-focus);
      box-shadow: 0 0 0 3px rgba(82, 113, 255, 0.15);
    }

    .otp-input {
      font-size: 22px !important;
      letter-spacing: 8px !important;
      text-align: center !important;
      font-weight: 700 !important;
      font-family: monospace, -apple-system, sans-serif !important;
      padding: 11px 14px !important;
    }

    .toggle-password-btn {
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
      background: transparent; border: none; color: var(--text-secondary); cursor: pointer;
      padding: 4px; display: flex; align-items: center; justify-content: center;
      transition: color 0.2s ease; z-index: 5;
    }
    .toggle-password-btn:hover { color: var(--text-primary); }

    /* ── Submit Button (Primary CTA) ── */
    .submit-btn,
    .primary-cta {
      color: #fff !important;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      font-style: normal;
      font-weight: 400 !important;
      width: 100%;
      margin-top: 8px;
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

    .submit-btn:hover:not(:disabled),
    .primary-cta:hover:not(:disabled) {
      opacity: 0.92;
    }

    .submit-btn:active:not(:disabled),
    .primary-cta:active:not(:disabled) {
      transform: scale(0.98);
    }

    .submit-btn:disabled,
    .primary-cta:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .otp-banner {
      background: var(--otp-banner-bg);
      border: 1px solid var(--otp-banner-border);
      border-radius: 10px;
      padding: 11px 13px;
      margin-bottom: 14px;
      text-align: left;
      font-size: 12px;
      color: var(--otp-banner-text);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .otp-banner p { margin: 2px 0 0; font-size: 11.5px; color: var(--text-secondary); }

    .change-email-btn {
      background: transparent;
      border: 1px solid var(--border-input);
      color: #5271FF;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .change-email-btn:hover {
      background: rgba(82, 113, 255, 0.1);
    }

    .resend-row {
      margin-top: 10px;
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
    }

    .resend-btn {
      background: transparent;
      border: none;
      color: #5271FF;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
    }

    .password-fallback-toggle {
      margin-top: 10px;
      text-align: center;
    }

    .password-fallback-link {
      font-size: 12px;
      color: var(--text-secondary);
      text-decoration: underline;
      cursor: pointer;
      background: none;
      border: none;
    }

    .password-fallback-link:hover {
      color: #5271FF;
    }

    .forgot-password-link {
      background: transparent;
      border: none;
      color: #5271FF;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      padding: 0;
      text-decoration: none;
      transition: color 0.15s ease;
    }

    .forgot-password-link:hover {
      color: #708AFF;
      text-decoration: underline;
    }

    .back-to-login-link {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: color 0.15s ease;
      display: inline-block;
      padding: 4px;
    }

    .back-to-login-link:hover {
      color: var(--text-primary);
      text-decoration: underline;
    }

    .error-msg {
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 12px;
      margin-bottom: 14px;
      display: none;
      text-align: left;
      line-height: 1.4;
    }

    body.light-mode .error-msg {
      color: #dc2626;
      background: #fee2e2;
      border-color: #fca5a5;
    }

    .success-msg {
      background: rgba(34, 197, 94, 0.14);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #86efac;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 12px;
      margin-bottom: 14px;
      display: none;
      text-align: left;
      line-height: 1.4;
    }

    body.light-mode .success-msg {
      color: #15803d;
      background: #dcfce7;
      border-color: #86efac;
    }

    .terms-text {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.4;
      margin-top: 14px;
      text-align: center;
    }

    .terms-text a {
      color: #5271FF;
      text-decoration: underline;
    }
  </style>
</head>
<body class="${initialThemeClass}">
  <div class="auth-container">
    <!-- Brand Favicon.png -->
    <div class="plugin-icon">
      <img src="${iconSrc}" alt="Reviewfic" width="48" height="48" />
    </div>

    <div class="logo">Reviewfic</div>
    <div id="auth-subtitle" class="subtitle">Sign in or create an account to continue in Framer</div>

    <div id="error" class="error-msg"></div>
    <div id="success" class="success-msg"></div>

    <!-- Mode Tabs: Sign In / Sign Up -->
    <div id="auth-tabs" class="tabs">
      <button type="button" id="tab-login" class="tab ${initialMode === 'login' ? 'active' : ''}">Sign In</button>
      <button type="button" id="tab-register" class="tab ${initialMode === 'register' ? 'active' : ''}">Sign Up</button>
    </div>

    <!-- Auth Form -->
    <form id="auth-form" onsubmit="handleAuthSubmit(event)">
      <!-- Name field (Sign Up only) -->
      <div id="group-username" class="form-group" style="display: ${initialMode === 'register' ? 'block' : 'none'};">
        <label for="username">Full Name</label>
        <input type="text" id="username" ${initialMode === 'register' ? 'required' : ''} placeholder="John Doe">
      </div>

      <!-- Email field -->
      <div id="group-email" class="form-group">
        <label for="email">Email Address</label>
        <input type="email" id="email" required placeholder="you@example.com">
      </div>

      <!-- Password field (Sign Up or Password fallback) -->
      <div id="group-password" class="form-group" style="display: ${initialMode === 'register' ? 'block' : 'none'};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label for="password" style="margin-bottom: 0;">Password</label>
          <button type="button" id="forgot-password-link" class="forgot-password-link" onclick="openForgotPassword(event)" style="display: none;">Forgot password?</button>
        </div>
        <div class="input-wrapper">
          <input type="password" id="password" ${initialMode === 'register' ? 'required' : ''} placeholder="••••••••" style="padding-right: 42px;">
          <button type="button" id="toggle-password-btn" class="toggle-password-btn" onclick="togglePasswordVisibility()" aria-label="Toggle Password Visibility">
            <svg id="eye-icon-show" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <svg id="eye-icon-hide" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- OTP Step Container (Shown during code verification) -->
      <div id="group-otp" style="display: none;">
        <div class="otp-banner">
          <div>
            <strong>Check your inbox</strong>
            <p>Code sent to <span id="otp-target-email" style="font-weight:600;"></span></p>
          </div>
          <button type="button" class="change-email-btn" onclick="cancelOtpStep()">Change</button>
        </div>

        <div class="form-group">
          <label for="otp-code">6-Digit Verification Code</label>
          <input type="text" id="otp-code" class="otp-input" maxlength="6" placeholder="123456" inputmode="numeric" autocomplete="one-time-code">
        </div>

        <div class="resend-row">
          <span id="resend-timer-text">Resend code in <b id="resend-countdown">30</b>s</span>
          <button type="button" id="resend-btn" class="resend-btn" style="display: none;" onclick="resendOtpCode()">Resend Code</button>
        </div>
      </div>

      <!-- New Password field (Shown during password reset step 2) -->
      <div id="group-new-password" class="form-group" style="display: none;">
        <label for="new-password">New Password</label>
        <div class="input-wrapper">
          <input type="password" id="new-password" placeholder="At least 6 characters" style="padding-right: 42px;">
          <button type="button" id="toggle-new-password-btn" class="toggle-password-btn" onclick="toggleNewPasswordVisibility()" aria-label="Toggle Password Visibility">
            <svg id="eye-icon-new-show" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <svg id="eye-icon-new-hide" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- Main Action Button -->
      <button type="submit" id="submit-btn" class="submit-btn primary-cta">
        ${initialMode === 'register' ? 'Sign Up - Start 7 Days Free Trial' : 'Continue with Email'}
      </button>

      <!-- Password Fallback Option for Sign In -->
      <div id="password-fallback-wrapper" class="password-fallback-toggle" style="display: ${initialMode === 'login' ? 'block' : 'none'};">
        <button type="button" id="password-fallback-link" class="password-fallback-link" onclick="togglePasswordFallback()">
          Or sign in with password
        </button>
      </div>

      <!-- Back to Sign In Option for Forgot Password -->
      <div id="back-to-login-wrapper" class="password-fallback-toggle" style="display: none;">
        <button type="button" id="back-to-login-link" class="back-to-login-link" onclick="cancelForgotPassword(event)">
          ← Back to Sign In
        </button>
      </div>

      <!-- Divider: Or Continue With Google -->
      <div id="auth-divider" class="divider">or continue with</div>

      <!-- Continue with Google Button -->
      <a id="google-auth-btn" class="social-btn-google" href="${defaultGoogleHref}">
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span id="google-btn-text">${initialMode === 'register' ? 'Sign up with Google' : 'Continue with Google'}</span>
      </a>

      <p class="terms-text">
        By continuing, you agree to our <a href="https://framefic.com/terms-conditions/" target="_blank" rel="noreferrer">Terms &amp; Conditions</a>.
      </p>
    </form>
  </div>

  <script>
    (function() {
      var currentMode = ${JSON.stringify(initialMode)};
      var sessionId = ${JSON.stringify(sessionId)};
      var siteId = ${JSON.stringify(siteId || '')};
      var framerUserId = ${JSON.stringify(framerUserId || '')};
      var siteName = ${JSON.stringify(siteName || '')};
      var siteUrl = ${JSON.stringify(siteUrl || '')};
      var isPasswordless = true;
      var otpStepActive = false;
      var sentEmail = '';
      var sentUsername = '';
      var sentPassword = '';
      var countdownInterval = null;

      // Theme detection & synchronization: strictly dark unless theme=light is provided
      var urlParams = new URLSearchParams(window.location.search);
      var currentTheme = (urlParams.get('theme') || ${JSON.stringify(theme)} || '').toLowerCase().trim();
      function applyTheme() {
        var isLight = currentTheme === 'light';
        document.documentElement.classList.toggle('light-mode', isLight);
        document.documentElement.classList.toggle('dark-mode', !isLight);
        document.body.classList.toggle('light-mode', isLight);
        document.body.classList.toggle('dark-mode', !isLight);
      }
      applyTheme();

      window.togglePasswordVisibility = function() {
        var passwordInput = document.getElementById('password');
        var eyeShow = document.getElementById('eye-icon-show');
        var eyeHide = document.getElementById('eye-icon-hide');
        if (passwordInput) {
          if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            if (eyeShow) eyeShow.style.display = 'none';
            if (eyeHide) eyeHide.style.display = 'block';
          } else {
            passwordInput.type = 'password';
            if (eyeShow) eyeShow.style.display = 'block';
            if (eyeHide) eyeHide.style.display = 'none';
          }
        }
      };

      window.toggleNewPasswordVisibility = function() {
        var newPasswordInput = document.getElementById('new-password');
        var eyeShow = document.getElementById('eye-icon-new-show');
        var eyeHide = document.getElementById('eye-icon-new-hide');
        if (newPasswordInput) {
          if (newPasswordInput.type === 'password') {
            newPasswordInput.type = 'text';
            if (eyeShow) eyeShow.style.display = 'none';
            if (eyeHide) eyeHide.style.display = 'block';
          } else {
            newPasswordInput.type = 'password';
            if (eyeShow) eyeShow.style.display = 'block';
            if (eyeHide) eyeHide.style.display = 'none';
          }
        }
      };

      window.openForgotPassword = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        setAuthMode('forgot');
      };

      window.cancelForgotPassword = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        setAuthMode('login');
      };

      function getApiUrl(path) {
        var p = window.location.pathname;
        var basePath = p.indexOf('/reviewfic') !== -1 ? '/reviewfic' : (p.indexOf('/beaf') !== -1 ? '/beaf' : '');
        var cleanPath = path.startsWith('/') ? path : '/' + path;
        return basePath + cleanPath;
      }

      function updateGoogleAuthLink() {
        var googleBtn = document.getElementById('google-auth-btn');
        if (googleBtn) {
          var googlePath = '/api/auth/google?sessionId=' + encodeURIComponent(sessionId) +
            (currentMode === 'register' ? '&mode=register' : '') +
            (currentTheme ? '&theme=' + encodeURIComponent(currentTheme) : '') +
            (siteId ? '&siteId=' + encodeURIComponent(siteId) : '') +
            (framerUserId ? '&framerUserId=' + encodeURIComponent(framerUserId) : '') +
            (siteName ? '&siteName=' + encodeURIComponent(siteName) : '') +
            (siteUrl ? '&siteUrl=' + encodeURIComponent(siteUrl) : '');
          googleBtn.href = getApiUrl(googlePath);
        }
      }

      window.setAuthMode = function(mode) {
        currentMode = mode;
        otpStepActive = false;
        clearInterval(countdownInterval);

        var loginTab = document.getElementById('tab-login');
        var registerTab = document.getElementById('tab-register');
        var authTabs = document.getElementById('auth-tabs');
        var authSubtitle = document.getElementById('auth-subtitle');
        if (loginTab) loginTab.classList.toggle('active', mode === 'login');
        if (registerTab) registerTab.classList.toggle('active', mode === 'register');
        
        var groupUsername = document.getElementById('group-username');
        var usernameInput = document.getElementById('username');
        var groupEmail = document.getElementById('group-email');
        var emailInput = document.getElementById('email');
        var groupPassword = document.getElementById('group-password');
        var passwordInput = document.getElementById('password');
        var groupNewPassword = document.getElementById('group-new-password');
        var newPasswordInput = document.getElementById('new-password');
        var forgotPasswordLink = document.getElementById('forgot-password-link');
        var groupOtp = document.getElementById('group-otp');
        var otpInput = document.getElementById('otp-code');
        var fallbackWrapper = document.getElementById('password-fallback-wrapper');
        var fallbackLink = document.getElementById('password-fallback-link');
        var backToLoginWrapper = document.getElementById('back-to-login-wrapper');
        var submitBtn = document.getElementById('submit-btn');
        var googleBtnText = document.getElementById('google-btn-text');
        var divider = document.getElementById('auth-divider');
        var googleBtn = document.getElementById('google-auth-btn');
        var errorEl = document.getElementById('error');
        var successEl = document.getElementById('success');
        if (errorEl) errorEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';

        if (groupOtp) groupOtp.style.display = 'none';
        if (otpInput) {
          otpInput.removeAttribute('required');
          otpInput.value = '';
        }
        if (groupNewPassword) groupNewPassword.style.display = 'none';
        if (newPasswordInput) {
          newPasswordInput.removeAttribute('required');
          newPasswordInput.value = '';
        }

        if (mode === 'forgot') {
          if (authTabs) authTabs.style.display = 'none';
          if (authSubtitle) authSubtitle.textContent = 'Reset your password to continue in Framer';
          if (groupUsername) groupUsername.style.display = 'none';
          if (usernameInput) usernameInput.removeAttribute('required');
          if (groupEmail) groupEmail.style.display = 'block';
          if (emailInput) {
            emailInput.setAttribute('required', 'required');
            emailInput.focus();
          }
          if (groupPassword) groupPassword.style.display = 'none';
          if (passwordInput) passwordInput.removeAttribute('required');
          if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
          if (fallbackWrapper) fallbackWrapper.style.display = 'none';
          if (backToLoginWrapper) backToLoginWrapper.style.display = 'block';
          if (divider) divider.style.display = 'none';
          if (googleBtn) googleBtn.style.display = 'none';
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Reset Code';
          }
        } else if (mode === 'register') {
          if (authTabs) authTabs.style.display = 'flex';
          if (authSubtitle) authSubtitle.textContent = 'Sign in or create an account to continue in Framer';
          if (groupUsername) groupUsername.style.display = 'block';
          if (usernameInput) usernameInput.setAttribute('required', 'required');
          if (groupEmail) groupEmail.style.display = 'block';
          if (emailInput) emailInput.setAttribute('required', 'required');
          if (groupPassword) groupPassword.style.display = 'block';
          if (passwordInput) passwordInput.setAttribute('required', 'required');
          if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
          if (fallbackWrapper) fallbackWrapper.style.display = 'none';
          if (backToLoginWrapper) backToLoginWrapper.style.display = 'none';
          if (divider) divider.style.display = 'flex';
          if (googleBtn) googleBtn.style.display = 'flex';
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign Up - Start 7 Days Free Trial';
          }
          if (googleBtnText) googleBtnText.textContent = 'Sign up with Google';
        } else {
          // Login mode (Passwordless by default)
          isPasswordless = true;
          if (authTabs) authTabs.style.display = 'flex';
          if (authSubtitle) authSubtitle.textContent = 'Sign in or create an account to continue in Framer';
          if (groupUsername) groupUsername.style.display = 'none';
          if (usernameInput) usernameInput.removeAttribute('required');
          if (groupEmail) groupEmail.style.display = 'block';
          if (emailInput) emailInput.setAttribute('required', 'required');
          if (groupPassword) groupPassword.style.display = 'none';
          if (passwordInput) passwordInput.removeAttribute('required');
          if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
          if (fallbackWrapper) fallbackWrapper.style.display = 'block';
          if (backToLoginWrapper) backToLoginWrapper.style.display = 'none';
          if (fallbackLink) fallbackLink.textContent = 'Or sign in with password';
          if (divider) divider.style.display = 'flex';
          if (googleBtn) googleBtn.style.display = 'flex';
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continue with Email';
          }
          if (googleBtnText) googleBtnText.textContent = 'Continue with Google';
        }
        
        updateGoogleAuthLink();
      };

      window.togglePasswordFallback = function() {
        isPasswordless = !isPasswordless;
        var groupPassword = document.getElementById('group-password');
        var passwordInput = document.getElementById('password');
        var forgotPasswordLink = document.getElementById('forgot-password-link');
        var submitBtn = document.getElementById('submit-btn');
        var fallbackLink = document.getElementById('password-fallback-link');
        var groupOtp = document.getElementById('group-otp');
        var otpInput = document.getElementById('otp-code');
        var groupEmail = document.getElementById('group-email');
        var divider = document.getElementById('auth-divider');
        var googleBtn = document.getElementById('google-auth-btn');

        if (groupOtp) groupOtp.style.display = 'none';
        if (otpInput) {
          otpInput.removeAttribute('required');
          otpInput.value = '';
        }
        if (groupEmail) groupEmail.style.display = 'block';
        if (divider) divider.style.display = 'flex';
        if (googleBtn) googleBtn.style.display = 'flex';
        otpStepActive = false;

        if (isPasswordless) {
          if (groupPassword) groupPassword.style.display = 'none';
          if (passwordInput) passwordInput.removeAttribute('required');
          if (forgotPasswordLink) forgotPasswordLink.style.display = 'none';
          if (submitBtn) submitBtn.textContent = 'Continue with Email';
          if (fallbackLink) fallbackLink.textContent = 'Or sign in with password';
        } else {
          if (groupPassword) groupPassword.style.display = 'block';
          if (forgotPasswordLink) forgotPasswordLink.style.display = 'inline';
          if (passwordInput) {
            passwordInput.setAttribute('required', 'required');
            passwordInput.focus();
          }
          if (submitBtn) submitBtn.textContent = 'Sign In';
          if (fallbackLink) fallbackLink.textContent = 'Or sign in with email code (passwordless)';
        }
      };

      window.cancelOtpStep = function() {
        otpStepActive = false;
        clearInterval(countdownInterval);
        var groupOtp = document.getElementById('group-otp');
        var otpInput = document.getElementById('otp-code');
        var groupUsername = document.getElementById('group-username');
        var usernameInput = document.getElementById('username');
        var groupEmail = document.getElementById('group-email');
        var emailInput = document.getElementById('email');
        var groupPassword = document.getElementById('group-password');
        var passwordInput = document.getElementById('password');
        var groupNewPassword = document.getElementById('group-new-password');
        var newPasswordInput = document.getElementById('new-password');
        var submitBtn = document.getElementById('submit-btn');
        var fallbackWrapper = document.getElementById('password-fallback-wrapper');
        var backToLoginWrapper = document.getElementById('back-to-login-wrapper');
        var divider = document.getElementById('auth-divider');
        var googleBtn = document.getElementById('google-auth-btn');

        if (groupOtp) groupOtp.style.display = 'none';
        if (otpInput) {
          otpInput.removeAttribute('required');
          otpInput.value = '';
        }
        if (groupNewPassword) groupNewPassword.style.display = 'none';
        if (newPasswordInput) {
          newPasswordInput.removeAttribute('required');
          newPasswordInput.value = '';
        }

        if (currentMode === 'forgot') {
          if (groupEmail) groupEmail.style.display = 'block';
          if (emailInput) {
            emailInput.setAttribute('required', 'required');
            emailInput.focus();
          }
          if (backToLoginWrapper) backToLoginWrapper.style.display = 'block';
          if (divider) divider.style.display = 'none';
          if (googleBtn) googleBtn.style.display = 'none';
          if (submitBtn) submitBtn.textContent = 'Send Reset Code';
          return;
        }

        if (divider) divider.style.display = 'flex';
        if (googleBtn) googleBtn.style.display = 'flex';

        if (currentMode === 'register') {
          if (groupUsername) groupUsername.style.display = 'block';
          if (usernameInput) usernameInput.setAttribute('required', 'required');
          if (groupEmail) groupEmail.style.display = 'block';
          if (emailInput) {
            emailInput.setAttribute('required', 'required');
            emailInput.focus();
          }
          if (groupPassword) groupPassword.style.display = 'block';
          if (passwordInput) passwordInput.setAttribute('required', 'required');
          if (fallbackWrapper) fallbackWrapper.style.display = 'none';
          if (submitBtn) submitBtn.textContent = 'Sign Up - Start 7 Days Free Trial';
        } else {
          if (groupUsername) groupUsername.style.display = 'none';
          if (groupEmail) groupEmail.style.display = 'block';
          if (emailInput) {
            emailInput.setAttribute('required', 'required');
            emailInput.focus();
          }
          if (fallbackWrapper) fallbackWrapper.style.display = 'block';
          if (isPasswordless) {
            if (groupPassword) groupPassword.style.display = 'none';
            if (passwordInput) passwordInput.removeAttribute('required');
            if (submitBtn) submitBtn.textContent = 'Continue with Email';
          } else {
            if (groupPassword) groupPassword.style.display = 'block';
            if (passwordInput) passwordInput.setAttribute('required', 'required');
            if (submitBtn) submitBtn.textContent = 'Sign In';
          }
        }
      };

      function startResendCountdown() {
        clearInterval(countdownInterval);
        var countdownEl = document.getElementById('resend-countdown');
        var timerText = document.getElementById('resend-timer-text');
        var resendBtn = document.getElementById('resend-btn');
        var secondsLeft = 30;

        if (timerText) timerText.style.display = 'inline';
        if (resendBtn) resendBtn.style.display = 'none';
        if (countdownEl) countdownEl.textContent = secondsLeft;

        countdownInterval = setInterval(function() {
          secondsLeft--;
          if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
            if (timerText) timerText.style.display = 'none';
            if (resendBtn) resendBtn.style.display = 'inline';
          } else if (countdownEl) {
            countdownEl.textContent = secondsLeft;
          }
        }, 1000);
      }

      window.resendOtpCode = async function() {
        var email = sentEmail || document.getElementById('email').value.trim();
        var username = sentUsername || document.getElementById('username').value.trim();
        var errorEl = document.getElementById('error');
        if (errorEl) errorEl.style.display = 'none';

        try {
          if (currentMode === 'forgot') {
            var res = await fetch(getApiUrl('/api/auth/forgot-password'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email })
            });
            var data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to resend reset code');
            startResendCountdown();
            return;
          }

          var isSignIn = currentMode !== 'register';
          var res = await fetch(getApiUrl('/api/auth/send-signup-code'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: username,
              email: email,
              isSignIn: isSignIn
            })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Failed to resend code');
          startResendCountdown();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || 'Failed to resend code';
            errorEl.style.display = 'block';
          }
        }
      };

      window.handleAuthSubmit = async function(e) {
        e.preventDefault();
        var email = document.getElementById('email').value.trim();
        var password = document.getElementById('password').value;
        var username = document.getElementById('username').value.trim();
        var otpCode = document.getElementById('otp-code').value.trim();
        var errorEl = document.getElementById('error');
        var successEl = document.getElementById('success');
        var submitBtn = document.getElementById('submit-btn');
        var groupOtp = document.getElementById('group-otp');
        var groupEmail = document.getElementById('group-email');
        var groupUsername = document.getElementById('group-username');
        var groupPassword = document.getElementById('group-password');
        var groupNewPassword = document.getElementById('group-new-password');
        var newPasswordInput = document.getElementById('new-password');
        var usernameInput = document.getElementById('username');
        var emailInput = document.getElementById('email');
        var passwordInput = document.getElementById('password');
        var otpInput = document.getElementById('otp-code');
        var divider = document.getElementById('auth-divider');
        var googleBtn = document.getElementById('google-auth-btn');
        var fallbackWrapper = document.getElementById('password-fallback-wrapper');
        var backToLoginWrapper = document.getElementById('back-to-login-wrapper');

        if (errorEl) errorEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';

        // ══════════════════════════════════════════════════════════
        // 0. FORGOT PASSWORD FLOW
        // ══════════════════════════════════════════════════════════
        if (currentMode === 'forgot') {
          // STEP A: Request 6-digit Reset Code
          if (!otpStepActive) {
            if (!email) {
              showAuthError('Please enter your email address.');
              return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending reset code...';

            try {
              var sendResetRes = await fetch(getApiUrl('/api/auth/forgot-password'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email })
              });
              var sendResetData = await sendResetRes.json();
              if (!sendResetRes.ok) throw new Error(sendResetData.message || 'Failed to send reset code');

              sentEmail = email;
              otpStepActive = true;
              document.getElementById('otp-target-email').textContent = email;

              if (groupEmail) groupEmail.style.display = 'none';
              if (emailInput) emailInput.removeAttribute('required');
              if (backToLoginWrapper) backToLoginWrapper.style.display = 'none';
              if (groupOtp) groupOtp.style.display = 'block';
              if (groupNewPassword) groupNewPassword.style.display = 'block';

              if (otpInput) {
                otpInput.setAttribute('required', 'required');
                otpInput.value = '';
                otpInput.focus();
              }
              if (newPasswordInput) {
                newPasswordInput.setAttribute('required', 'required');
                newPasswordInput.value = '';
              }

              submitBtn.disabled = false;
              submitBtn.textContent = 'Reset Password & Sign In';
              startResendCountdown();
            } catch (err) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Send Reset Code';
              showAuthError(err.message);
            }
            return;
          }

          // STEP B: Verify Code & Set New Password
          if (otpStepActive) {
            var newPasswordVal = newPasswordInput ? newPasswordInput.value : '';
            if (!otpCode || otpCode.length < 6) {
              showAuthError('Please enter the complete 6-digit verification code.');
              return;
            }
            if (!newPasswordVal || newPasswordVal.length < 6) {
              showAuthError('New password must be at least 6 characters.');
              return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Resetting password...';

            try {
              var resetRes = await fetch(getApiUrl('/api/auth/reset-password'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  email: sentEmail || email,
                  code: otpCode,
                  newPassword: newPasswordVal,
                  siteId: siteId || 'framer-cloud',
                  framerUserId: framerUserId,
                  siteName: siteName,
                  siteUrl: siteUrl,
                  framerSiteName: siteName,
                  framerSiteUrl: siteUrl,
                  sessionId: sessionId
                })
              });
              var resetData = await resetRes.json();
              if (!resetRes.ok) throw new Error(resetData.message || 'Failed to reset password');

              if (sessionId) {
                window.location.href = getApiUrl('/api/auth/me?token=' + encodeURIComponent(resetData.token) +
                  '&sessionId=' + encodeURIComponent(sessionId) +
                  (currentTheme ? '&theme=' + encodeURIComponent(currentTheme) : '') +
                  (siteId ? '&siteId=' + encodeURIComponent(siteId) : '') +
                  (framerUserId ? '&framerUserId=' + encodeURIComponent(framerUserId) : '') +
                  (siteName ? '&siteName=' + encodeURIComponent(siteName) : '') +
                  (siteUrl ? '&siteUrl=' + encodeURIComponent(siteUrl) : '')
                );
              } else {
                if (successEl) {
                  successEl.textContent = 'Password reset successfully! Please sign in with your new password.';
                  successEl.style.display = 'block';
                }
                setAuthMode('login');
              }
            } catch (err) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Reset Password & Sign In';
              showAuthError(err.message);
            }
            return;
          }
        }

        // ══════════════════════════════════════════════════════════
        // 1. SIGN UP (NEW USER REGISTRATION) FLOW WITH OTP
        // ══════════════════════════════════════════════════════════
        if (currentMode === 'register') {
          // STEP 1A: User filled registration form -> Send 6-digit OTP code to email
          if (!otpStepActive) {
            if (!username) {
              showAuthError('Please enter your full name.');
              return;
            }
            if (!email) {
              showAuthError('Please enter your email address.');
              return;
            }
            if (!password || password.length < 6) {
              showAuthError('Password must be at least 6 characters.');
              return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending verification code...';

            try {
              var sendRes = await fetch(getApiUrl('/api/auth/send-signup-code'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  username: username,
                  email: email,
                  isSignIn: false
                })
              });
              var sendData = await sendRes.json();
              if (!sendRes.ok) throw new Error(sendData.message || 'Failed to send verification code');

              // Save registration details in memory for verification
              sentEmail = email;
              sentUsername = username;
              sentPassword = password;
              otpStepActive = true;

              // Transition UI to OTP verification view
              document.getElementById('otp-target-email').textContent = email;
              if (groupUsername) groupUsername.style.display = 'none';
              if (groupEmail) groupEmail.style.display = 'none';
              if (groupPassword) groupPassword.style.display = 'none';
              if (fallbackWrapper) fallbackWrapper.style.display = 'none';
              if (divider) divider.style.display = 'none';
              if (googleBtn) googleBtn.style.display = 'none';
              if (groupOtp) groupOtp.style.display = 'block';

              // Remove required attributes on hidden fields to prevent HTML5 validation issues
              if (usernameInput) usernameInput.removeAttribute('required');
              if (emailInput) emailInput.removeAttribute('required');
              if (passwordInput) passwordInput.removeAttribute('required');

              if (otpInput) {
                otpInput.setAttribute('required', 'required');
                otpInput.value = '';
                otpInput.focus();
              }

              submitBtn.disabled = false;
              submitBtn.textContent = 'Verify Code & Start 7 Days Free Trial';
              startResendCountdown();
            } catch (err) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Sign Up - Start 7 Days Free Trial';
              showAuthError(err.message);
            }
            return;
          }

          // STEP 1B: User entered 6-digit OTP code -> Verify & complete registration
          if (otpStepActive) {
            if (!otpCode || otpCode.length < 6) {
              showAuthError('Please enter the complete 6-digit verification code.');
              return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying code & creating account...';

            try {
              var verifyRes = await fetch(getApiUrl('/api/auth/verify-signup-code'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  username: sentUsername || username,
                  email: sentEmail || email,
                  password: sentPassword || password,
                  code: otpCode,
                  siteId: siteId || 'framer-cloud',
                  framerUserId: framerUserId,
                  siteName: siteName,
                  siteUrl: siteUrl,
                  framerSiteName: siteName,
                  framerSiteUrl: siteUrl,
                  sessionId: sessionId
                })
              });
              var verifyData = await verifyRes.json();
              if (!verifyRes.ok) throw new Error(verifyData.message || 'Verification failed');

              if (sessionId) {
                window.location.href = getApiUrl('/api/auth/me?token=' + encodeURIComponent(verifyData.token) +
                  '&sessionId=' + encodeURIComponent(sessionId) +
                  '&mode=register' +
                  (currentTheme ? '&theme=' + encodeURIComponent(currentTheme) : '') +
                  (siteId ? '&siteId=' + encodeURIComponent(siteId) : '') +
                  (framerUserId ? '&framerUserId=' + encodeURIComponent(framerUserId) : '') +
                  (siteName ? '&siteName=' + encodeURIComponent(siteName) : '') +
                  (siteUrl ? '&siteUrl=' + encodeURIComponent(siteUrl) : '')
                );
              } else {
                alert('Successfully registered & verified! You can return to Framer.');
              }
            } catch (err) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Verify Code & Start 7 Days Free Trial';
              showAuthError(err.message);
            }
            return;
          }
        }

        // ══════════════════════════════════════════════════════════
        // 2. SIGN IN: PASSWORD MODE (Direct Login, No OTP)
        // ══════════════════════════════════════════════════════════
        if (!isPasswordless) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Signing in...';

          try {
            var loginRes = await fetch(getApiUrl('/api/auth/login'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: email,
                password: password,
                siteId: siteId,
                framerUserId: framerUserId,
                siteName: siteName,
                siteUrl: siteUrl
              })
            });
            var loginData = await loginRes.json();
            if (!loginRes.ok) throw new Error(loginData.message || 'Login failed');

            if (sessionId) {
              window.location.href = getApiUrl('/api/auth/me?token=' + encodeURIComponent(loginData.token) +
                '&sessionId=' + encodeURIComponent(sessionId) +
                (currentTheme ? '&theme=' + encodeURIComponent(currentTheme) : '') +
                (siteId ? '&siteId=' + encodeURIComponent(siteId) : '') +
                (framerUserId ? '&framerUserId=' + encodeURIComponent(framerUserId) : '') +
                (siteName ? '&siteName=' + encodeURIComponent(siteName) : '') +
                (siteUrl ? '&siteUrl=' + encodeURIComponent(siteUrl) : '')
              );
            } else {
              alert('Successfully authenticated! You can return to Framer.');
            }
          } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
            showAuthError(err.message);
          }
          return;
        }

        // ══════════════════════════════════════════════════════════
        // 3. SIGN IN: PASSWORDLESS STEP 1 (Request 6-digit Code)
        // ══════════════════════════════════════════════════════════
        if (!otpStepActive) {
          if (!email) {
            showAuthError('Please enter your email address.');
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending 6-digit code...';

          try {
            var sendLoginRes = await fetch(getApiUrl('/api/auth/send-signup-code'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email, isSignIn: true })
            });
            var sendLoginData = await sendLoginRes.json();
            if (!sendLoginRes.ok) throw new Error(sendLoginData.message || 'Failed to send login code');

            // Switch UI to OTP verification step
            sentEmail = email;
            otpStepActive = true;
            document.getElementById('otp-target-email').textContent = email;
            if (groupEmail) groupEmail.style.display = 'none';
            if (emailInput) emailInput.removeAttribute('required');
            if (fallbackWrapper) fallbackWrapper.style.display = 'none';
            if (divider) divider.style.display = 'none';
            if (googleBtn) googleBtn.style.display = 'none';
            if (groupOtp) groupOtp.style.display = 'block';
            
            if (otpInput) {
              otpInput.setAttribute('required', 'required');
              otpInput.value = '';
              otpInput.focus();
            }

            submitBtn.disabled = false;
            submitBtn.textContent = 'Verify & Sign In';
            startResendCountdown();
          } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continue with Email';
            showAuthError(err.message);
          }
          return;
        }

        // ══════════════════════════════════════════════════════════
        // 4. SIGN IN: PASSWORDLESS STEP 2 (Verify 6-digit Code)
        // ══════════════════════════════════════════════════════════
        if (otpStepActive) {
          if (!otpCode || otpCode.length < 6) {
            showAuthError('Please enter the complete 6-digit verification code.');
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Verifying code...';

          try {
            var verifyLoginRes = await fetch(getApiUrl('/api/auth/verify-signup-code'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: sentEmail,
                code: otpCode,
                siteId: siteId || 'framer-cloud',
                framerUserId: framerUserId,
                siteName: siteName,
                siteUrl: siteUrl,
                framerSiteName: siteName,
                framerSiteUrl: siteUrl,
                sessionId: sessionId
              })
            });
            var verifyLoginData = await verifyLoginRes.json();
            if (!verifyLoginRes.ok) throw new Error(verifyLoginData.message || 'Verification failed');

            if (sessionId) {
              window.location.href = getApiUrl('/api/auth/me?token=' + encodeURIComponent(verifyLoginData.token) +
                '&sessionId=' + encodeURIComponent(sessionId) +
                (currentTheme ? '&theme=' + encodeURIComponent(currentTheme) : '') +
                (siteId ? '&siteId=' + encodeURIComponent(siteId) : '') +
                (framerUserId ? '&framerUserId=' + encodeURIComponent(framerUserId) : '') +
                (siteName ? '&siteName=' + encodeURIComponent(siteName) : '') +
                (siteUrl ? '&siteUrl=' + encodeURIComponent(siteUrl) : '')
              );
            } else {
              alert('Successfully authenticated! You can return to Framer.');
            }
          } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Verify & Sign In';
            showAuthError(err.message);
          }
        }
      };

      function showAuthError(msg) {
        var errorEl = document.getElementById('error');
        var successEl = document.getElementById('success');
        if (successEl) successEl.style.display = 'none';
        if (!errorEl) return;
        var cleanMsg = msg || 'An error occurred';

        if (cleanMsg.indexOf('already exists') !== -1) {
          errorEl.innerHTML = cleanMsg + ' <a href="#" id="err-login-link" style="color:#5271FF;font-weight:600;text-decoration:underline;margin-left:4px;">Sign In here</a>';
          var link = document.getElementById('err-login-link');
          if (link) link.onclick = function(e) { e.preventDefault(); setAuthMode('login'); };
        } else if (cleanMsg.indexOf('No account found') !== -1) {
          errorEl.innerHTML = cleanMsg + ' <a href="#" id="err-reg-link" style="color:#5271FF;font-weight:600;text-decoration:underline;margin-left:4px;">Sign Up with free trial</a>';
          var regLink = document.getElementById('err-reg-link');
          if (regLink) regLink.onclick = function(e) { e.preventDefault(); setAuthMode('register'); };
        } else {
          errorEl.textContent = cleanMsg;
        }
        errorEl.style.display = 'block';
      }

      document.getElementById('tab-login').addEventListener('click', function(e) {
        e.preventDefault();
        setAuthMode('login');
      });

      document.getElementById('tab-register').addEventListener('click', function(e) {
        e.preventDefault();
        setAuthMode('register');
      });

      document.addEventListener('DOMContentLoaded', function() {
        updateGoogleAuthLink();
      });
    })();
  </script>
</body>
</html>`;
}
