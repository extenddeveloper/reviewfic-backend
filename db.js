import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

let pool = null;

export function parseDbUrl(dbUrl) {
  if (!dbUrl) return null;
  try {
    const match = dbUrl.match(/^mysql:\/\/([^:]+)(?::([^@]+))?@([^/]+)\/(.+)$/);
    if (match) {
      const [, user, password, hostPort, database] = match;
      const [host, port] = hostPort.split(':');
      return {
        user: decodeURIComponent(user),
        password: password ? decodeURIComponent(password) : '',
        host,
        port: port ? parseInt(port, 10) : 3306,
        database: database.split('?')[0],
      };
    }
  } catch (e) {
    console.error('⚠️ Failed to parse DB_URL:', e);
  }
  return null;
}

export function getPool() {
  return pool;
}

export async function query(sql, params = []) {
  if (!pool) {
    throw new Error('Database pool not initialized. Make sure MySQL (Laragon) is running.');
  }
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Initialize Reviewfic database:
 * 1. Creates database if not exists (Laragon / local MySQL)
 * 2. Creates connection pool
 * 3. Runs schema migrations for:
 *    - Webhook events & idempotency
 *    - Payments & subscriptions
 *    - Reviewfic user authentication
 *    - 7-day trials
 *    - Google Places & Trustpilot review caches
 *    - Connected businesses & usage tracking
 */
export async function initializeDb() {
  let dbName = process.env.DB_NAME || 'framefic-reviewfic';
  const useUrl = !!process.env.DB_URL;
  const parsedUrl = useUrl ? parseDbUrl(process.env.DB_URL) : null;

  if (parsedUrl) {
    dbName = parsedUrl.database || dbName;
  }

  const dbHost = parsedUrl ? parsedUrl.host : (process.env.DB_HOST || 'localhost');
  const dbPort = parsedUrl ? parsedUrl.port : parseInt(process.env.DB_PORT || '3306', 10);
  const dbUser = parsedUrl ? parsedUrl.user : (process.env.DB_USER || 'root');
  const dbPassword = parsedUrl ? parsedUrl.password : (process.env.DB_PASSWORD || '');

  // ── Step 1: Create database if it doesn't exist (Laragon / local MySQL) ──
  try {
    const bootstrapConn = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
    });
    await bootstrapConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await bootstrapConn.end();
    console.log(`✅ Database '${dbName}' ready or verified.`);
  } catch (err) {
    console.warn(`⚠️ Warning during database bootstrap (${err.message}). Attempting pool connection...`);
  }

  // ── Step 2: Create connection pool ──
  try {
    pool = mysql.createPool({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      timezone: 'Z',
      charset: 'utf8mb4',
    });

    const testConn = await pool.getConnection();
    console.log(`🔌 Connected to database '${dbName}' on ${dbHost}:${dbPort}`);
    testConn.release();
  } catch (err) {
    console.warn(`⚠️ Database connection failed (${err.message}). If using Laragon, please make sure MySQL is started.`);
    pool = null;
    return;
  }

  // ── Step 3: Run schema migrations ──
  const conn = await pool.getConnection();
  try {
    // 1. Webhook idempotency events
    await conn.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        stripe_event_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(255) NOT NULL,
        payload LONGTEXT NOT NULL,
        processed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_stripe_event_id (stripe_event_id),
        INDEX idx_stripe_event_id (stripe_event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Payments & subscriptions
    await conn.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_login_id INT DEFAULT NULL,
        username VARCHAR(255) DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL,
        site_id VARCHAR(255) NOT NULL,
        site_name VARCHAR(255) DEFAULT NULL,
        site_url VARCHAR(2048) DEFAULT NULL,
        framer_user_id VARCHAR(255) DEFAULT NULL,
        plan VARCHAR(50) DEFAULT NULL,
        stripe_customer_id VARCHAR(255) DEFAULT NULL,
        stripe_subscription_id VARCHAR(255) DEFAULT NULL,
        payment_intent_id VARCHAR(255) DEFAULT NULL,
        amount DECIMAL(10,2) DEFAULT NULL,
        currency VARCHAR(20) DEFAULT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        expires_at DATETIME NULL,
        coupon_code VARCHAR(255) DEFAULT NULL,
        user_feedback TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_stripe_subscription_id (stripe_subscription_id),
        UNIQUE KEY unique_payment_intent_id (payment_intent_id),
        INDEX idx_site_id (site_id),
        INDEX idx_user_login_id (user_login_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Alias / backward-compatible userlogin tables
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`reviewfic-userlogin\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) DEFAULT NULL,
        plan VARCHAR(50) DEFAULT NULL,
        subscription_status VARCHAR(50) DEFAULT NULL,
        cancel_status VARCHAR(50) DEFAULT NULL,
        payment_status VARCHAR(50) DEFAULT NULL,
        google_id VARCHAR(255) DEFAULT NULL,
        facebook_id VARCHAR(255) DEFAULT NULL,
        avatar_url TEXT DEFAULT NULL,
        is_verified TINYINT DEFAULT 0,
        user_feedback TEXT DEFAULT NULL,
        framer_site_url VARCHAR(500) DEFAULT NULL,
        framer_site_name VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);


    // 4. Reviewfic 7-day trials
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reviewfic_trials (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        site_id VARCHAR(255) NOT NULL,
        site_name VARCHAR(255) DEFAULT NULL,
        site_url VARCHAR(2048) DEFAULT NULL,
        framer_user_id VARCHAR(255) DEFAULT NULL,
        trial_start DATETIME NOT NULL,
        trial_end DATETIME NOT NULL,
        components_added INT DEFAULT 0,
        current_plan_status VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_site_id (site_id),
        INDEX idx_framer_user_id (framer_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

// 5. Google Places Cache
    await conn.query(`
      CREATE TABLE IF NOT EXISTS google_places_cache (
        place_id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        formatted_address TEXT,
        rating DECIMAL(3, 2) DEFAULT 0.00,
        user_ratings_total INT DEFAULT 0,
        maps_url TEXT,
        reviews LONGTEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Trustpilot Cache
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trustpilot_cache (
        domain VARCHAR(255) PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        rating DECIMAL(3, 2) DEFAULT 0.00,
        total_reviews INT DEFAULT 0,
        profile_url TEXT,
        reviews LONGTEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_business_name (business_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Search Predictions Cache
    await conn.query(`
      CREATE TABLE IF NOT EXISTS search_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        search_query VARCHAR(255) NOT NULL UNIQUE,
        results LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Connected Businesses
    await conn.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id VARCHAR(64) PRIMARY KEY,
        site_token VARCHAR(128) NULL,
        name VARCHAR(255) NOT NULL,
        google_place_id VARCHAR(255) NULL,
        google_business_name VARCHAR(255) NULL,
        trustpilot_domain VARCHAR(255) NULL,
        metadata LONGTEXT NULL,
        last_synced_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_site_token (site_token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 9. Usage & Sync Tracking
    await conn.query(`
      CREATE TABLE IF NOT EXISTS usage_tracking (
        id INT AUTO_INCREMENT PRIMARY KEY,
        site_token VARCHAR(128) NULL,
        business_id VARCHAR(64) NULL,
        action_type VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_token (site_token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure crmfic_synced tracking columns exist across tables
    const syncColumns = [
      { name: 'crmfic_synced', ddl: 'ADD COLUMN crmfic_synced TINYINT(1) NOT NULL DEFAULT 0' },
      { name: 'crmfic_synced_at', ddl: 'ADD COLUMN crmfic_synced_at DATETIME NULL' },
    ];
    const tablesToMigrate = ['payments', 'reviewfic_trials', 'reviewfic-userlogin'];
    for (const table of tablesToMigrate) {
      for (const col of syncColumns) {
        try {
          const [existing] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
            [dbName, table, col.name]
          );
          if (existing.length === 0) {
            await conn.query(`ALTER TABLE \`${table}\` ${col.ddl}`);
          }
        } catch (colErr) {
          // Table might not exist yet or warning
        }
      }
    }

    // ── Seed Themefic verified place so local testing is 100% instant ──
    const themeficReviews = [
      {
        author_name: "AL SUZAUD DOWLA",
        author_url: "https://www.google.com/maps/contrib/116076072036528494413/reviews",
        profile_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjVFuoKyVATT8vUZKYOx70u71QV_alcGee6IC_ojOR2BEJe8ECwx=s128-c0x00000000-cc-rp-mo-ba3",
        rating: 5,
        text: "Love the products made by Themefic. Especially the Ultimate Addons for Contact Form 7 plugin helped me customize forms for my clients the most efficient way. Their Hotel and Tour Booking plugin is better then I expected. I have a plan to use their other plugin called BEAF too.",
        language: "en",
        time: 1698764415,
        published_at_date: "2023-10-31T15:00:15.953Z",
        relative_time_description: "2 years ago",
        review_url: "https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChdDSUhNMG9nS0VJQ0FnSUNGM1pLTmlnRRAB!2m1!1s0x3755c789ec66c97d:0x2f16afa340df57a2"
      },
      {
        author_name: "Tauhid Sajib",
        author_url: "https://www.google.com/maps/contrib/104889654923649788377/reviews",
        profile_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjVbL8awbByPwik-ZuEmGrfjscuXqM2Hfg-pXFY7YeTl3J9T81MWDQ=s128-c0x00000000-cc-rp-mo",
        rating: 5,
        text: "Good at IT Company in Bangladesh.\nThere are some enthusiastic guy, who care each bit about web projects.",
        language: "en",
        time: 1662143638,
        published_at_date: "2022-09-02T18:33:58.369Z",
        relative_time_description: "4 years ago",
        review_url: "https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChZDSUhNMG9nS0VJQ0FnSUMydnRMTFNREAE!2m1!1s0x3755c789ec66c97d:0x2f16afa340df57a2"
      },
      {
        author_name: "Ken Latham",
        author_url: "https://www.google.com/maps/contrib/110085876195530732642/reviews",
        profile_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjWJ2NkN1bH3CC6APo6trX_jSS8Zuash95fwj_3hTP5vYzzh-MAyKg=s128-c0x00000000-cc-rp-mo",
        rating: 5,
        text: "BEAF was not working. Their technical support resolved the problem for me. I would recommend and use their products.",
        language: "en",
        time: 1671895190,
        published_at_date: "2022-12-24T15:19:50.919Z",
        relative_time_description: "3 years ago",
        review_url: "https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChZDSUhNMG9nS0VJQ0FnSUNCbHZ1TUZBEAE!2m1!1s0x3755c789ec66c97d:0x2f16afa340df57a2"
      },
      {
        author_name: "Dev Kabir",
        author_url: "https://www.google.com/maps/contrib/103837143235925789046/reviews",
        profile_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjUwRDdhmtOJtaanXkA0HADu8Nmv_iAfcmp7D_1NipMJfc5uu0AQ=s128-c0x00000000-cc-rp-mo",
        rating: 5,
        text: "A very enjoyable and comfortable place for WordPress developers.",
        language: "en",
        time: 1659260949,
        published_at_date: "2022-07-31T09:49:09.187Z",
        relative_time_description: "4 years ago",
        review_url: "https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChZDSUhNMG9nS0VJQ0FnSUN1aWNMZFZnEAE!2m1!1s0x3755c789ec66c97d:0x2f16afa340df57a2"
      },
      {
        author_name: "Mizanur Rahaman Mizan",
        author_url: "https://www.google.com/maps/contrib/114334055929471011478/reviews",
        profile_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjWCigkbu4lRVyeqctRmas_ELyVUFWHzrv-ng63Ony5tTswDVXM6=s128-c0x00000000-cc-rp-mo-ba5",
        rating: 5,
        text: "Wonderful #WordPress startup from #Bangladesh",
        language: "en",
        time: 1624191159,
        published_at_date: "2021-06-20T12:12:39.390Z",
        relative_time_description: "5 years ago",
        review_url: "https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChZDSUhNMG9nS0VJQ0FnSUNxLV9hNWZREAE!2m1!1s0x3755c789ec66c97d:0x2f16afa340df57a2"
      }
    ];

    await conn.query(`
      INSERT INTO google_places_cache (place_id, name, formatted_address, rating, user_ratings_total, maps_url, reviews)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        rating = VALUES(rating),
        user_ratings_total = VALUES(user_ratings_total),
        reviews = VALUES(reviews);
    `, [
      "ChIJfclm7InHVTcRolffQKOvFi8",
      "Themefic",
      "Plot# 4 (8th Floor, Block# F Banasree Main Rd, Dhaka 1219, Bangladesh",
      4.6,
      20,
      "https://maps.google.com/?cid=3392900705139095458",
      JSON.stringify(themeficReviews)
    ]);

    // Seed Themefic Trustpilot
    const themeficTpReviews = [
      {
        id: "tp_6ae1ec7735b6b92b1ddc2ba6",
        date: "2026-10-28T14:37:11.000Z",
        text: "The best support experience! Thanks Themefic team!",
        title: "The best support experience",
        rating: 5,
        platform: "trustpilot",
        verified: true,
        sourceUrl: "https://www.trustpilot.com/reviews/6ae1ec7735b6b92b1ddc2ba6",
        authorName: "ChrisB",
        authorPhoto: ""
      },
      {
        id: "tp_6ab3b1c82ac4298094878fcc",
        date: "2026-09-23T13:02:32.000Z",
        text: "Very nice company with useful plugin i'm happy to pay for it !",
        title: "Very nice company with useful plugin…",
        rating: 5,
        platform: "trustpilot",
        verified: true,
        sourceUrl: "https://www.trustpilot.com/reviews/6ab3b1c82ac4298094878fcc",
        authorName: "Bryce",
        authorPhoto: ""
      },
      {
        id: "tp_6a779c2f2478871fc80665dd",
        date: "2026-08-08T23:14:23.000Z",
        text: "The plugin is very good, easy to set up, with good service and excellent support. I RECOMMEND IT",
        title: "Excellent plugin, recommended.",
        rating: 5,
        platform: "trustpilot",
        verified: true,
        sourceUrl: "https://www.trustpilot.com/reviews/6a779c2f2478871fc80665dd",
        authorName: "Sonero Mayor",
        authorPhoto: "https://user-images.trustpilot.com/6a779ad1056498321165a935/73x73.png"
      }
    ];

    await conn.query(`
      INSERT INTO trustpilot_cache (domain, business_name, rating, total_reviews, profile_url, reviews)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        rating = VALUES(rating),
        total_reviews = VALUES(total_reviews),
        reviews = VALUES(reviews);
    `, [
      "themefic.com",
      "Themefic",
      5.0,
      67,
      "https://www.trustpilot.com/review/themefic.com",
      JSON.stringify(themeficTpReviews)
    ]);

    console.log('🚀 All Reviewfic database tables and seeded caches initialized successfully!');
  } catch (migrationErr) {
    console.error('❌ Error during schema initialization:', migrationErr);
  } finally {
    conn.release();
  }
}

/**
 * Database query wrapper compatible with both pool.query and db.query
 */
const db = {
  query: async (...args) => {
    if (!pool) throw new Error('Database not initialized or unreachable. Please verify MySQL is running in Laragon.');
    return pool.query(...args);
  },
  getConnection: async () => {
    if (!pool) throw new Error('Database not initialized or unreachable. Please verify MySQL is running in Laragon.');
    return pool.getConnection();
  },
};

export default db;
