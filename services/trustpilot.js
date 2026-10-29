import axios from 'axios';
import * as cheerio from 'cheerio';
import { query } from '../db.js';

export function normalizeDomain(input) {
  if (!input) return '';
  let str = input.trim();
  str = str.replace(/^https?:\/\//i, '');
  str = str.replace(/^www\./i, '');
  str = str.replace(/^trustpilot\.com\/review\//i, '');
  str = str.split('/')[0].split('?')[0].toLowerCase();
  return str;
}

/**
 * Verify a Trustpilot business profile and get overall stats
 */
export async function verifyTrustpilotBusiness(input) {
  const domain = normalizeDomain(input);
  if (!domain) {
    throw new Error('A valid domain or Trustpilot URL is required');
  }

  // 1. Check local cache
  try {
    const cached = await query(
      `SELECT domain, business_name, rating, total_reviews, profile_url 
       FROM trustpilot_cache WHERE domain = ? LIMIT 1`,
      [domain]
    );

    if (cached.length > 0) {
      const c = cached[0];
      return {
        valid: true,
        domain: c.domain,
        businessName: c.business_name,
        averageRating: parseFloat(c.rating || 5.0),
        totalCount: c.total_reviews || 0,
        profileUrl: c.profile_url || `https://www.trustpilot.com/review/${domain}`,
      };
    }
  } catch (err) {
    console.warn('⚠️ Trustpilot cache lookup warning:', err.message);
  }

  // 2. Fetch live Trustpilot public page
  const profileUrl = `https://www.trustpilot.com/review/${domain}`;
  try {
    const res = await axios.get(profileUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(res.data);

    // Business Name
    let businessName = $('span.title_displayName__TtDD9, h1 span, meta[property="og:title"]')
      .first()
      .text()
      .trim();
    if (!businessName) {
      businessName = domain.split('.')[0].toUpperCase();
    }

    // Rating
    let rating = 5.0;
    const ratingText = $('p.typography_body-l__KUYFJ, [data-rating-typography="true"]').first().text().trim();
    if (ratingText && !isNaN(parseFloat(ratingText))) {
      rating = parseFloat(ratingText);
    }

    // Review Count
    let totalCount = 0;
    const countText = $('span.typography_body-l__KUYFJ, [data-reviews-count-typography="true"]').first().text();
    const countMatch = countText.replace(/,/g, '').match(/\d+/);
    if (countMatch) {
      totalCount = parseInt(countMatch[0], 10);
    }

    // Parse Initial Reviews
    const reviews = parseTrustpilotHtml($, profileUrl);

    // Cache in MySQL
    await query(
      `INSERT INTO trustpilot_cache (domain, business_name, rating, total_reviews, profile_url, reviews)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         business_name = VALUES(business_name),
         rating = VALUES(rating),
         total_reviews = VALUES(total_reviews),
         reviews = VALUES(reviews),
         updated_at = NOW();`,
      [domain, businessName, rating, totalCount || reviews.length, profileUrl, JSON.stringify(reviews)]
    ).catch(() => {});

    return {
      valid: true,
      domain,
      businessName,
      averageRating: rating,
      totalCount: totalCount || reviews.length,
      profileUrl,
    };
  } catch (err) {
    if (err.response?.status === 404) {
      return {
        valid: false,
        error: `Trustpilot profile not found for domain '${domain}'. Please make sure the domain has a Trustpilot profile.`,
      };
    }
    // Fallback: If network issue, check if in DB even if expired
    const fallback = await query(`SELECT * FROM trustpilot_cache WHERE domain = ? LIMIT 1`, [domain]);
    if (fallback.length > 0) {
      const c = fallback[0];
      return {
        valid: true,
        domain: c.domain,
        businessName: c.business_name,
        averageRating: parseFloat(c.rating || 5.0),
        totalCount: c.total_reviews || 0,
        profileUrl: c.profile_url,
      };
    }
    throw new Error(`Failed to verify Trustpilot: ${err.message}`);
  }
}

/**
 * Get Trustpilot reviews with caching
 */
export async function getTrustpilotReviews(input, options = {}) {
  const { limit = 20, forceRefresh = false } = options;
  const domain = normalizeDomain(input);

  if (!domain) {
    throw new Error('A valid domain or Trustpilot URL is required');
  }

  // 1. Check database cache
  if (!forceRefresh) {
    try {
      const rows = await query(`SELECT * FROM trustpilot_cache WHERE domain = ? LIMIT 1`, [domain]);
      if (rows.length > 0 && rows[0].reviews) {
        const item = rows[0];
        let reviews = JSON.parse(item.reviews || '[]');
        if (limit && limit > 0) reviews = reviews.slice(0, limit);

        return {
          cached: true,
          domain: item.domain,
          businessName: item.business_name,
          averageRating: parseFloat(item.rating || 5.0),
          totalCount: item.total_reviews || reviews.length,
          reviews,
          syncedAt: item.updated_at,
        };
      }
    } catch (err) {
      console.warn('⚠️ Cache lookup warning:', err.message);
    }
  }

  // 2. Fetch live and update cache
  const verification = await verifyTrustpilotBusiness(domain);
  if (!verification.valid) {
    throw new Error(verification.error || 'Trustpilot profile could not be verified');
  }

  // Read updated from DB
  const rows = await query(`SELECT * FROM trustpilot_cache WHERE domain = ? LIMIT 1`, [domain]);
  const item = rows[0] || verification;
  let reviews = [];
  try {
    reviews = typeof item.reviews === 'string' ? JSON.parse(item.reviews) : (item.reviews || []);
  } catch {
    reviews = [];
  }

  if (limit && limit > 0) reviews = reviews.slice(0, limit);

  return {
    cached: false,
    domain: item.domain || domain,
    businessName: item.business_name || verification.businessName,
    averageRating: parseFloat(item.rating || verification.averageRating || 5.0),
    totalCount: item.total_reviews || verification.totalCount || reviews.length,
    reviews,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Cheerio HTML parser for Trustpilot public review cards
 */
function parseTrustpilotHtml($, profileUrl) {
  const reviews = [];

  $('article, [data-service-review-card="true"]').each((idx, el) => {
    try {
      const card = $(el);

      // Reviewer Name
      const authorName =
        card.find('[data-consumer-name-typography="true"], span.typography_heading-xxs__QKBS8').text().trim() ||
        'Verified Customer';

      // Reviewer Photo
      const authorPhoto =
        card.find('img[data-consumer-avatar-image="true"]').attr('src') ||
        card.find('img[loading="lazy"]').attr('src') ||
        '';

      // Star Rating
      let rating = 5;
      const starsImg = card.find('[data-service-review-rating] img, [data-rating-typography] img, img[alt*="stars"]');
      const altText = starsImg.attr('alt') || '';
      const ratingMatch = altText.match(/(\d+)/);
      if (ratingMatch) {
        rating = parseInt(ratingMatch[1], 10);
      }

      // Title & Text
      const title = card.find('[data-service-review-title-typography="true"], h2').text().trim();
      const text =
        card.find('[data-service-review-text-typography="true"], p.typography_body-l__KUYFJ').text().trim() || title;

      // Date
      const timeElem = card.find('time');
      const date = timeElem.attr('datetime') || new Date().toISOString();

      // Verified status
      const verified = card.text().toLowerCase().includes('verified') || card.find('svg[aria-label*="Verified"]').length > 0;

      // Review URL
      const relativeLink = card.find('a[href*="/reviews/"]').attr('href');
      const sourceUrl = relativeLink
        ? `https://www.trustpilot.com${relativeLink}`
        : `${profileUrl}#${idx + 1}`;

      const id = 'tp_' + Buffer.from(authorName + date).toString('hex').slice(0, 16);

      reviews.push({
        id,
        authorName,
        authorPhoto,
        rating,
        title,
        text,
        date,
        verified,
        platform: 'trustpilot',
        sourceUrl,
      });
    } catch (err) {
      // Continue next card
    }
  });

  return reviews;
}

