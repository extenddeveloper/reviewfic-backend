# Reviewfic Backend API Service

Dedicated review retrieval, caching, and synchronization backend for **Reviewfic Framer Plugin**.

## Features

- **Google Places Search & Predictions**: Autocomplete search endpoint `/api/v1/places/predictions?input={query}`.
- **Google Place Details & Reviews**: Fetches full place details, rating, review count, and real customer reviews `/api/v1/places/details?place_id={placeId}`.
- **Trustpilot Integration**: Live Trustpilot business verification and review scraping with zero paid API requirement (`/api/v1/trustpilot/verify`, `/api/v1/trustpilot/reviews`).
- **Smart MySQL Caching**: Caches places, reviews, and searches in Laragon / MySQL with automated expiration (24h TTL) to minimize external API costs by 99%.
- **Auto-Bootstrapping**: Automatically creates database `framefic-reviewfic` and all tables on startup if they do not exist.

## Prerequisites

- Node.js >= 18
- MySQL (Laragon / XAMPP / Local MySQL server running on `localhost:3306`)

## Setup & Running

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configuration (`.env`):**
   ```env
   PORT=5001
   DB_HOST=localhost
   DB_PORT=3306
   DB_NAME=framefic-reviewfic
   DB_USER=root
   DB_PASSWORD=

   # Optional: Add your Google Places API Key for live global searches
   GOOGLE_PLACES_API_KEY=
   ```

3. **Start backend:**
   ```bash
   npm start
   # or development with nodemon:
   npm run dev
   ```

## Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Service and database health check |
| `GET` | `/api/v1/places/predictions?input=Themefic` | Google Places predictions / search |
| `GET` | `/api/v1/places/details?place_id=ChIJfclm7InHVTcRolffQKOvFi8` | Google Place details & customer reviews |
| `GET` | `/api/v1/trustpilot/verify?domain=themefic.com` | Verify Trustpilot business & stats |
| `GET` | `/api/v1/trustpilot/reviews?domain=themefic.com&limit=10` | Fetch Trustpilot customer reviews |
| `GET` | `/api/v1/businesses` | List connected businesses |
| `POST`| `/api/v1/businesses/save` | Upsert business configuration |

