import axios from 'axios';
import { query } from '../db.js';

/**
 * Search Google Places predictions
 * Matches format used by RevuKit & Vanssay
 */
export async function searchGooglePlaces(input) {
  const cleanInput = (input || '').trim();
  if (!cleanInput) {
    return { results: [], predictions: [] };
  }

  // 1. Check local search cache first (only return if it has actual predictions)
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

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // 2. If Google API Key is provided, call Google Places Autocomplete API
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

        // Save valid results to search cache
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

  // 3. Fallback: Search from local MySQL database cache (e.g. seeded Themefic and previously saved places)
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
        `SELECT * FROM google_places_cache WHERE place_id = ? LIMIT 1`,
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
    } catch (err) {
      console.warn('⚠️ Cache lookup warning:', err.message);
    }
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // 2. Fetch live from Google Places Details API
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
        };
      }
    } catch (err) {
      console.warn('⚠️ Google Details API error:', err.message);
    }
  }

  // 3. Fallback: Check if place exists in database even if expired
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
