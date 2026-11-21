# Wayfinder Archive — Location History Explorer

A zero-dependency Node.js web application for excavating the overlooked everyday history, Indigenous & regional roots, named owners, walking maps, weird metrics, and local lore of any street address or landmark.

Built with **Node.js 18+** (0 npm dependencies) and **Vanilla HTML, CSS, and JavaScript** (no frontend frameworks).

## Highlights

- **Hero Address Explorer & Quick-Pick Stops**: Search any address, storefront, café, or landmark—or jump right into verified pre-seeded dossiers starting with **Beau Jo's Idaho Springs** (`1517–1523 Miner St, Idaho Springs, CO 80452`) and **Hotel de Paris Museum** (`409 6th St, Georgetown, CO 80444`).
- **Modular Field Kit Toggles**: Show or hide each of the five field-guide modules independently (saved in `localStorage`):
  1. **Story & Audio Guide** — Unhurried editorial narrative chapters plus a Web Speech API **"Listen Along"** bar (play/pause/stop, prev/next paragraph, speed `0.85×–1.5×`, narrator voice picker, active paragraph highlight, click-any-paragraph playback, and a scroll-triggered **floating mini-player**).
  2. **Walking Map & Closest-First Gems** — Hand-styled interactive SVG walking map with collision-free numbered pins synced bidirectionally to closest-first gem cards, distance/walk time, survival status badges, and highlighted **On-Site Spotter Tips**.
  3. **Peel Back Time** — Visual **65/35 Chronological Funnel** (35% ancient/regional context → 65% immediate block, exact parcel & people) paired with an interactive **Era Scrubber** slider.
  4. **Fact or Tall Tale?** — Playable **3D CSS flip cards** testing *Verified Fact*, *Local Lore*, and *Tall Tale* verdicts with live scoring and streaks.
  5. **Archives & Export** — Browser-saved Field Book (`localStorage`), primary archival sources & dig-deeper leads, plus one-click **Download `.md`**, **Download `.json`**, **Copy Notes**, and **Print / PDF**.
- **Resilient Live AI + Graceful Fallback**:
  - Uses `GEMINI_API_KEY` (**Gemini 2.5 Flash** with native `google_search` grounding) when configured.
  - Falls back to `OPENAI_API_KEY` if Gemini is not set.
  - If neither API key is configured yet, `POST /api/explore` returns **HTTP 200** with a friendly setup notice and the verified pre-seeded dossier so visitors can immediately try every interactive tool.

## Project Structure

```text
wayfinder-archive/
├── server.js          # Zero-dependency Node 18+ HTTP server & API router
├── package.json       # Node 18+ engine metadata, 0 dependencies
├── render.yaml        # Render Blueprint with /api/health check
├── .env.example       # Optional environment variables guide
├── data/
│   └── stops.json     # Verified pre-seeded 65/35 dossiers (Beau Jo's + 9 Miner St gems, Hotel de Paris)
└── public/
    ├── index.html     # Semantic heritage UI
    ├── styles.css     # Warm archival parchment design system + print stylesheet
    └── app.js         # Modular Field Kit client logic
```

## Quick Start (Local)

Requires **Node.js 18 or newer** (no `npm install` needed!).

```bash
# 1. Optional: configure a Gemini API key for live address lookups
cp .env.example .env
# Edit .env and add GEMINI_API_KEY=your_key_here

# 2. Start the server
npm start
```

Then visit `http://localhost:3000`.

## API Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check used by Render (returns Node version, uptime, seeded stop count, and provider readiness). |
| `GET` | `/api/stops` | Returns all pre-seeded verified dossiers from `data/stops.json`. |
| `POST` | `/api/explore` | Body `{ "query": "1517 Miner St, Idaho Springs, CO" }`. Returns a matched verified stop, a live Gemini/OpenAI grounded dossier, or a graceful HTTP 200 fallback notice + pre-seeded dossier. |

## Deploy to Render (Free Tier)

1. Push this repository to GitHub (`main` branch).
2. Sign in at [render.com](https://render.com), click **New + → Blueprint**, and select your `wayfinder-archive` repository.
3. Render automatically reads `render.yaml` (`node server.js`, health check `/api/health`).
4. When prompted for environment variables (or afterward under **Environment**), add `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey) and save.
5. Render deploys automatically and gives you a public `https://wayfinder-archive.onrender.com` URL!