import axios from 'axios';
import { query } from '../db.js';

/**
 * Search Google Places predictions
 * Supports SerpApi (primary), Google Places Autocomplete API, and local database cache
 */
export async function searchGooglePlaces(input) {
  const cleanInput = (input || '').trim();
  if (!cleanInput) {
    return { results: [], predictions: [] };
  }

  // 1. Check local search cache first (24h TTL)
  try {
    const cached = await query(
      `SELECT results, updated_at FROM search_cache WHERE search_query = ? AND updated_at > NOW() - INTERVAL 24 HOUR LIMIT 1`,
      [cleanInput.toLowerCase()]
    );
    if (cached.length > 0 && cached[0].results) {
      const parsed = JSON.parse(cached[0].results);
      if (parsed && Array.isArray(parsed.predictions) && parsed.predictions.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('⚠️ Search cache read warning:', err.message);
  }

  // 2. SerpApi Google Maps search (Primary - provides full places with Place ID, rating, reviews)
  const serpApiKey = process.env.SERPAPI_API_KEY;
  if (serpApiKey && serpApiKey.trim() !== '') {
    try {
      const url = `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(
        cleanInput
      )}&api_key=${serpApiKey}&hl=en`;

      const res = await axios.get(url, { timeout: 10000 });
      let items = [];
      if (Array.isArray(res.data?.local_results) && res.data.local_results.length > 0) {
        items = res.data.local_results;
      } else if (res.data?.place_results) {
        items = [res.data.place_results];
      }

      if (items.length > 0) {
        const predictions = items.map((p) => ({
          place_id: p.place_id || p.data_id || `place-${cleanInput.toLowerCase()}`,
          description: `${p.title}${p.address ? `, ${p.address}` : ''}`,
          structured_formatting: {
            main_text: p.title,
            secondary_text: p.address || '',
          },
        }));

        const results = items.map((p) => ({
          placeId: p.place_id || p.data_id || `place-${cleanInput.toLowerCase()}`,
          name: p.title,
          address: p.address || '',
          rating: parseFloat(p.rating || 0),
          totalCount: p.reviews || 0,
        }));

        const payload = { predictions, results };

        // Cache in MySQL search_cache
        await query(
          `INSERT INTO search_cache (search_query, results) VALUES (?, ?) ON DUPLICATE KEY UPDATE results = VALUES(results), updated_at = NOW()`,
          [cleanInput.toLowerCase(), JSON.stringify(payload)]
        ).catch(() => {});

        return payload;
      }
    } catch (err) {
      console.warn('⚠️ SerpApi search warning:', err.message);
    }
  }

  // 3. Fallback: Google Places Autocomplete API
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (apiKey && apiKey.trim() !== '' && !apiKey.includes('placeholder')) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
        cleanInput
      )}&types=establishment&key=${apiKey}`;

      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && Array.isArray(res.data.predictions) && res.data.predictions.length > 0) {
        const predictions = res.data.predictions.map((p) => ({
          place_id: p.place_id,
          description: p.description,
          structured_formatting: {
            main_text: p.structured_formatting?.main_text || p.description,
            secondary_text: p.structured_formatting?.secondary_text || '',
          },
        }));

        const results = predictions.map((p) => ({
          placeId: p.place_id,
          name: p.structured_formatting.main_text,
          address: p.structured_formatting.secondary_text,
        }));

        const payload = { predictions, results };

        await query(
          `INSERT INTO search_cache (search_query, results) VALUES (?, ?) ON DUPLICATE KEY UPDATE results = VALUES(results), updated_at = NOW()`,
          [cleanInput.toLowerCase(), JSON.stringify(payload)]
        ).catch(() => {});

        return payload;
      }
    } catch (err) {
      console.warn('⚠️ Google Autocomplete API notice:', err.message);
    }
  }

  // 4. Fallback: Search from local MySQL database cache
  try {
    const rows = await query(
      `SELECT place_id, name, formatted_address, rating, user_ratings_total 
       FROM google_places_cache 
       WHERE LOWER(name) LIKE ? OR LOWER(formatted_address) LIKE ? 
       LIMIT 10`,
      [`%${cleanInput.toLowerCase()}%`, `%${cleanInput.toLowerCase()}%`]
    );

    const predictions = rows.map((r) => ({
      place_id: r.place_id,
      description: `${r.name}, ${r.formatted_address || ''}`,
      structured_formatting: {
        main_text: r.name,
        secondary_text: r.formatted_address || '',
      },
    }));

    const results = rows.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      address: r.formatted_address || '',
      rating: parseFloat(r.rating || 0),
      totalCount: r.user_ratings_total || 0,
    }));

    if (predictions.length > 0) {
      return { predictions, results };
    }
  } catch (err) {
    console.error('❌ Local database search error:', err.message);
  }

  return { predictions: [], results: [] };
}

/**
 * Get Google Place Details and Reviews with caching
 * Supports SerpApi (primary), Google Places Details API, and MySQL cache
 */
export async function getGooglePlaceDetails(placeId, options = {}) {
  const { forceRefresh = false } = options;
  const cleanId = (placeId || '').trim();

  if (!cleanId) {
    throw new Error('place_id parameter is required');
  }

  // 1. Check database cache
  if (!forceRefresh) {
    try {
      const rows = await query(
        `SELECT * FROM google_places_cache WHERE place_id = ? AND updated_at > NOW() - INTERVAL 24 HOUR LIMIT 1`,
        [cleanId]
      );

      if (rows.length > 0) {
        const place = rows[0];
        let reviews = [];
        try {
          reviews = typeof place.reviews === 'string' ? JSON.parse(place.reviews) : (place.reviews || []);
        } catch (e) {
          reviews = [];
        }

        const totalExpected = place.user_ratings_total || 0;
        // Return cache if it has at least 10 reviews OR matches all total expected reviews
        if (reviews && (reviews.length >= 10 || (totalExpected > 0 && reviews.length >= totalExpected))) {
          return {
            place: {
              place_id: place.place_id,
              name: place.name,
              formatted_address: place.formatted_address,
              rating: parseFloat(place.rating || 0),
              user_ratings_total: place.user_ratings_total || 0,
              maps_url: place.maps_url,
              reviews,
            },
            fromCache: true,
            cachedAt: place.updated_at,
          };
        }
      }
    } catch (err) {
      console.warn('⚠️ Cache lookup warning:', err.message);
    }
  }

  // 2. Fetch live via SerpApi (Primary - multi-sort harvesting up to 24+ unique reviews with user avatars)
  const serpApiKey = process.env.SERPAPI_API_KEY;
  if (serpApiKey && serpApiKey.trim() !== '') {
    try {
      const sorts = ['qualityScore', 'newestFirst', 'ratingHigh', 'ratingLow'];

      const requests = sorts.map((s) =>
        axios
          .get('https://serpapi.com/search.json', {
            params: {
              engine: 'google_maps_reviews',
              place_id: cleanId,
              api_key: serpApiKey,
              hl: 'en',
              sort_by: s,
            },
            timeout: 10000,
          })
          .then((r) => r.data)
          .catch((err) => {
            console.warn(`⚠️ SerpApi sort=${s} error:`, err.message);
            return null;
          })
      );

      const results = await Promise.all(requests);
      let placeInfo = {};
      let maps_url = `https://maps.google.com/?cid=${cleanId}`;
      const seen = new Set();
      const rawReviews = [];
      let nextPageToken = null;

      for (const data of results) {
        if (!data) continue;
        if (!placeInfo.title && data.place_info) placeInfo = data.place_info;
        if (data.google_maps_reviews_url) maps_url = data.google_maps_reviews_url;
        if (!nextPageToken && data.serpapi_pagination?.next_page_token) {
          nextPageToken = data.serpapi_pagination.next_page_token;
        }

        for (const r of data.reviews || []) {
          const uniqueId =
            r.review_id || `${r.user?.name || ''}_${r.snippet || r.date || ''}`;
          if (!seen.has(uniqueId)) {
            seen.add(uniqueId);
            rawReviews.push(r);
          }
        }
      }

      // If next page token exists and we need more reviews towards the 24 cap, fetch page 2
      if (nextPageToken && rawReviews.length < 24) {
        try {
          const p2Res = await axios.get('https://serpapi.com/search.json', {
            params: {
              engine: 'google_maps_reviews',
              place_id: cleanId,
              api_key: serpApiKey,
              hl: 'en',
              next_page_token: nextPageToken,
            },
            timeout: 10000,
          });
          for (const r of p2Res.data?.reviews || []) {
            const uniqueId =
              r.review_id || `${r.user?.name || ''}_${r.snippet || r.date || ''}`;
            if (!seen.has(uniqueId)) {
              seen.add(uniqueId);
              rawReviews.push(r);
            }
          }
        } catch (e) {
          // ignore page 2 error
        }
      }

      if (rawReviews.length > 0 || placeInfo.title) {
        const name = placeInfo.title || 'Business';
        const formatted_address = placeInfo.address || '';
        const rating = parseFloat(placeInfo.rating || 5);
        const user_ratings_total = placeInfo.reviews || rawReviews.length;

        // Prioritize written reviews with text snippets first, followed by rated reviews
        rawReviews.sort((a, b) => {
          const aHasText = Boolean(a.snippet || a.extracted_snippet?.original);
          const bHasText = Boolean(b.snippet || b.extracted_snippet?.original);
          if (aHasText && !bHasText) return -1;
          if (!aHasText && bHasText) return 1;
          return 0;
        });

        // Limit to max 24 reviews for the plugin
        const reviews = rawReviews.slice(0, 24).map((r) => {
          const publishedDate = r.iso_date || '';
          const timeStamp = r.iso_date
            ? Math.floor(new Date(r.iso_date).getTime() / 1000)
            : Math.floor(Date.now() / 1000);

          return {
            author_name: r.user?.name || 'Google User',
            author_url: r.user?.link || '',
            profile_photo_url: r.user?.thumbnail || '',
            rating: Number(r.rating || 5),
            text: r.snippet || r.extracted_snippet?.original || '',
            language: 'en',
            time: timeStamp,
            published_at_date: publishedDate,
            relative_time_description: r.date || '',
            review_url: r.link || '',
          };
        });

        // Upsert into google_places_cache
        await query(
          `INSERT INTO google_places_cache (place_id, name, formatted_address, rating, user_ratings_total, maps_url, reviews)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             formatted_address = VALUES(formatted_address),
             rating = VALUES(rating),
             user_ratings_total = VALUES(user_ratings_total),
             maps_url = VALUES(maps_url),
             reviews = VALUES(reviews),
             updated_at = NOW()`,
          [
            cleanId,
            name,
            formatted_address,
            rating,
            user_ratings_total,
            maps_url,
            JSON.stringify(reviews),
          ]
        );

        return {
          place: {
            place_id: cleanId,
            name,
            formatted_address,
            rating,
            user_ratings_total,
            maps_url,
            reviews,
          },
          fromCache: false,
          provider: 'serpapi',
        };
      }
    } catch (err) {
      console.warn('⚠️ SerpApi reviews details warning:', err.message);
    }
  }

  // 3. Fallback: Google Places Details API
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (apiKey && apiKey.trim() !== '' && !apiKey.includes('placeholder')) {
    try {
      const fields = [
        'place_id',
        'name',
        'formatted_address',
        'rating',
        'user_ratings_total',
        'url',
        'reviews',
      ].join(',');

      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
        cleanId
      )}&fields=${fields}&key=${apiKey}`;

      const res = await axios.get(url, { timeout: 10000 });
      if (res.data && res.data.result) {
        const result = res.data.result;

        const reviews = (result.reviews || []).map((r) => ({
          author_name: r.author_name || 'Google User',
          author_url: r.author_url || '',
          profile_photo_url: r.profile_photo_url || '',
          rating: r.rating || 5,
          text: r.text || '',
          language: r.language || 'en',
          time: r.time || Math.floor(Date.now() / 1000),
          published_at_date: new Date((r.time || 0) * 1000).toISOString(),
          relative_time_description: r.relative_time_description || '',
          review_url: '',
        }));

        await query(
          `INSERT INTO google_places_cache (place_id, name, formatted_address, rating, user_ratings_total, maps_url, reviews)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             formatted_address = VALUES(formatted_address),
             rating = VALUES(rating),
             user_ratings_total = VALUES(user_ratings_total),
             maps_url = VALUES(maps_url),
             reviews = VALUES(reviews),
             updated_at = NOW()`,
          [
            cleanId,
            result.name || 'Business',
            result.formatted_address || '',
            result.rating || 0,
            result.user_ratings_total || 0,
            result.url || '',
            JSON.stringify(reviews),
          ]
        );

        return {
          place: {
            place_id: cleanId,
            name: result.name,
            formatted_address: result.formatted_address,
            rating: result.rating || 0,
            user_ratings_total: result.user_ratings_total || 0,
            maps_url: result.url,
            reviews,
          },
          fromCache: false,
          provider: 'google_places',
        };
      }
    } catch (err) {
      console.warn('⚠️ Google Details API error:', err.message);
    }
  }

  // 4. Fallback: Check if place exists in database even if expired
  const fallbackRows = await query(
    `SELECT * FROM google_places_cache WHERE place_id = ? LIMIT 1`,
    [cleanId]
  );

  if (fallbackRows.length > 0) {
    const place = fallbackRows[0];
    let reviews = [];
    try {
      reviews = typeof place.reviews === 'string' ? JSON.parse(place.reviews) : [];
    } catch {
      reviews = [];
    }
    return {
      place: {
        place_id: place.place_id,
        name: place.name,
        formatted_address: place.formatted_address,
        rating: parseFloat(place.rating || 0),
        user_ratings_total: place.user_ratings_total || 0,
        maps_url: place.maps_url,
        reviews,
      },
      fromCache: true,
      fallback: true,
    };
  }

  throw new Error(`Place with ID '${cleanId}' not found.`);
}
