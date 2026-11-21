'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Zero-dependency .env loader (does not overwrite existing process.env vars)
// ---------------------------------------------------------------------------
function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn('[wayfinder] Could not read .env file:', err.message);
  }
}

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_PATH = path.join(__dirname, 'data', 'stops.json');
const MAX_BODY_BYTES = 256 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

// ---------------------------------------------------------------------------
// Seeded dossier store
// ---------------------------------------------------------------------------
function loadSeededStops() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.stops) ? parsed.stops : [];
  } catch (err) {
    console.error('[wayfinder] Failed to load data/stops.json:', err.message);
    return [];
  }
}

const SEEDED_STOPS = loadSeededStops();

function getProviderStatus() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  const activeProvider = hasGemini ? 'gemini' : hasOpenAI ? 'openai' : 'none';
  return {
    gemini: hasGemini,
    openai: hasOpenAI,
    activeProvider,
    liveSearchReady: hasGemini || hasOpenAI,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  };
}

// ---------------------------------------------------------------------------
// Matching helper for pre-seeded dossiers
// ---------------------------------------------------------------------------
function findMatchingSeededStop(query) {
  const normalized = String(query || '').toLowerCase().trim();
  if (!normalized) return null;

  for (const stop of SEEDED_STOPS) {
    if (stop.id === normalized || stop.slug === normalized) return stop;
    if (stop.name && stop.name.toLowerCase().includes(normalized)) return stop;
    if (stop.address && stop.address.toLowerCase().includes(normalized)) return stop;
    if (Array.isArray(stop.keywords)) {
      for (const kw of stop.keywords) {
        if (normalized.includes(kw.toLowerCase())) {
          return stop;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Live AI prompt & normalization (65/35 Location History Explorer schema)
// ---------------------------------------------------------------------------
function buildExplorerPrompt(userQuery) {
  return `You are the archival historian for "Wayfinder Archive — Location History Explorer".
Research this specific place thoroughly: "${userQuery}".

Follow the 65/35 Chronological Funnel method:
- Spend roughly 35% of the historical narrative on genuine Tier 3–4 context (ancient geology, Indigenous stewardship/toponymy, and the wider regional boom/bust arc).
- Funnel ~65% tightly onto Tier 1–2: the exact building, lot/homestead/subdivision, named owners, multi-generation families, former businesses, everyday working-class life, weird architectural/zoning metrics, and documented vs. local-lore tales.
- In narrative chapters (Sections 1–4), write warm, unhurried, voice-friendly prose paragraphs with NO bullet points or bracket tags.
- Provide 6 to 8 verified nearby hidden gems sorted STRICTLY CLOSEST FIRST (rank 1 = closest), with authentic survival status ("Intact Historic Building", "Vanished Site / Plaque", "Relocated Industrial Relic", "Intact Historic Museum", etc.) and concrete on-site Spotter Tips telling a visitor what physical detail to inspect.
- Spread the gem mapX (between 90 and 710) and mapY (between 95 and 375) coordinates cleanly around an anchor at (400, 210) so no two pins sit on top of each other.
- Provide 5 to 7 chronological Era Scrubber milestones and 5 to 6 playable "Fact or Tall Tale?" cards using verdicts strictly from: "Verified Fact", "Local Lore", or "Tall Tale".

Return ONLY a single valid JSON object (no commentary before or after) matching this exact structure:
{
  "name": "Official Place Name",
  "subtitle": "Short heritage subtitle · 1-line identity",
  "shortLabel": "Short Name · City, ST",
  "address": "Exact street address, City, State ZIP",
  "neighborhood": "Micro-neighborhood, historic district, or subdivision",
  "coordinates": { "lat": 0.0, "lng": 0.0, "display": "39.7425° N, 105.5136° W" },
  "elevation": "e.g. 5,280 ft",
  "yearBuilt": "e.g. 1892",
  "archetype": "e.g. Historic Storefront / Landmark / Neighborhood",
  "listenMinutes": 7,
  "tagline": "One vivid, evocative sentence hooking the listener on this exact plot.",
  "chapters": [
    { "id": "overview", "number": 1, "title": "Location Overview", "paragraphs": ["...", "..."] },
    { "id": "history", "number": 2, "title": "Deep & Everyday History", "paragraphs": ["...", "...", "...", "..."] },
    { "id": "weird", "number": 3, "title": "Weird Facts & Unusual Metrics", "paragraphs": ["...", "..."] },
    { "id": "lore", "number": 4, "title": "Curiosities, Obscure Tales & Local Lore", "paragraphs": ["...", "..."] }
  ],
  "pulse": {
    "summary": "1-2 sentence summary of recent community updates or preservation status.",
    "highlights": ["Highlight 1", "Highlight 2"]
  },
  "funnel": {
    "contextShare": 35,
    "localShare": 65,
    "tiers": [
      { "tier": 4, "group": "context", "label": "Ancient Ground & Regional Era", "share": "20%", "title": "...", "summary": "...", "details": ["...", "..."] },
      { "tier": 3, "group": "context", "label": "Corridor & Creek Evolution", "share": "15%", "title": "...", "summary": "...", "details": ["...", "..."] },
      { "tier": 2, "group": "local", "label": "Immediate Block & Neighbors", "share": "25%", "title": "...", "summary": "...", "details": ["...", "..."] },
      { "tier": 1, "group": "local", "label": "Exact Parcel, Building & People", "share": "40%", "title": "...", "summary": "...", "details": ["...", "..."] }
    ]
  },
  "eras": [
    { "year": "Pre-1850", "eraTitle": "...", "standingHere": "...", "scene": "...", "keyPeople": "...", "artifact": "..." }
  ],
  "mapConfig": {
    "title": "Neighborhood Walking Map",
    "subtitle": "Centered on the primary stop · Gems ordered closest first",
    "anchor": { "x": 400, "y": 210, "label": "Short Anchor Label" },
    "streets": [
      { "type": "main", "label": "PRIMARY STREET NAME", "x1": 40, "y1": 176, "x2": 760, "y2": 176 },
      { "type": "cross", "label": "Cross St W", "x1": 240, "y1": 50, "x2": 240, "y2": 340 },
      { "type": "cross", "label": "Cross St E", "x1": 560, "y1": 50, "x2": 560, "y2": 340 }
    ],
    "waterways": [],
    "landmarks": [],
    "scaleLabel": "200 ft / ~60 m"
  },
  "gems": [
    {
      "rank": 1,
      "name": "Closest Gem Name",
      "address": "Street address or intersection",
      "distance": "~80 ft E",
      "walkTime": "1 min walk",
      "status": "Intact Historic Building",
      "statusType": "intact",
      "year": "1888",
      "mapX": 470,
      "mapY": 210,
      "story": "Concise historical story.",
      "spotterTip": "Exact physical detail to look for on-site."
    }
  ],
  "trivia": [
    {
      "id": "t-1",
      "claim": "Specific intriguing claim about this place.",
      "verdict": "Verified Fact",
      "explanation": "Clear archival explanation.",
      "sourceNote": "Source or oral tradition note"
    }
  ],
  "sources": {
    "consulted": [
      { "title": "Primary or secondary source title", "detail": "What it documents", "url": "" }
    ],
    "digDeeper": [
      { "label": "Specific archive or map collection", "instruction": "Exact tip on what to search" }
    ]
  }
}`;
}

function extractJsonObject(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty AI response.');
  }
  let cleaned = rawText.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    cleaned = fenced[1].trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Could not locate a JSON object in model output.');
  }
  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

function slugify(str) {
  return String(str || 'custom-stop')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'custom-stop';
}

function normalizeStop(raw, query, groundingSources = []) {
  const name = raw.name || query;
  const slug = `${slugify(name)}-${crypto.randomBytes(2).toString('hex')}`;
  const chapters = Array.isArray(raw.chapters) && raw.chapters.length
    ? raw.chapters.map((ch, idx) => ({
        id: ch.id || `chapter-${idx + 1}`,
        number: Number(ch.number) || idx + 1,
        title: ch.title || `Chapter ${idx + 1}`,
        paragraphs: Array.isArray(ch.paragraphs)
          ? ch.paragraphs.filter((p) => typeof p === 'string' && p.trim())
          : []
      }))
    : [
        {
          id: 'overview',
          number: 1,
          title: 'Location Overview',
          paragraphs: [raw.tagline || `Archival field notes for ${name}.`]
        }
      ];

  const gems = Array.isArray(raw.gems)
    ? raw.gems.map((g, idx) => {
        const statusText = g.status || 'Historic Site';
        let statusType = g.statusType || 'intact';
        if (!['intact', 'vanished', 'relic'].includes(statusType)) {
          const lower = statusText.toLowerCase();
          if (lower.includes('vanish') || lower.includes('demolish') || lower.includes('plaque') || lower.includes('park')) {
            statusType = 'vanished';
          } else if (lower.includes('relic') || lower.includes('reconstruct') || lower.includes('marker')) {
            statusType = 'relic';
          } else {
            statusType = 'intact';
          }
        }
        return {
          rank: Number(g.rank) || idx + 1,
          name: g.name || `Nearby Stop ${idx + 1}`,
          address: g.address || 'Nearby corridor',
          distance: g.distance || 'Nearby',
          walkTime: g.walkTime || '2–5 min walk',
          status: statusText,
          statusType,
          year: g.year || 'Historic',
          mapX: Number.isFinite(Number(g.mapX)) ? Number(g.mapX) : 140 + ((idx * 105) % 540),
          mapY: Number.isFinite(Number(g.mapY)) ? Number(g.mapY) : idx % 2 === 0 ? 130 : 280,
          story: g.story || '',
          spotterTip: g.spotterTip || 'Inspect the roofline, masonry, and nearby historical markers.'
        };
      })
    : [];

  const trivia = Array.isArray(raw.trivia)
    ? raw.trivia.map((card, idx) => {
        const allowed = ['Verified Fact', 'Local Lore', 'Tall Tale'];
        const verdict = allowed.includes(card.verdict) ? card.verdict : 'Verified Fact';
        return {
          id: card.id || `trivia-${idx + 1}`,
          claim: card.claim || '',
          verdict,
          explanation: card.explanation || '',
          sourceNote: card.sourceNote || 'Archival record'
        };
      })
    : [];

  const consulted = Array.isArray(raw.sources?.consulted) ? [...raw.sources.consulted] : [];
  const seenUrls = new Set(consulted.map((s) => s.url).filter(Boolean));
  for (const gs of groundingSources) {
    if (gs.url && !seenUrls.has(gs.url)) {
      seenUrls.add(gs.url);
      consulted.push(gs);
    }
  }

  return {
    id: slug,
    slug,
    name,
    subtitle: raw.subtitle || 'Live Archival Field Dossier',
    shortLabel: raw.shortLabel || name,
    address: raw.address || query,
    neighborhood: raw.neighborhood || 'Local Historic Corridor',
    coordinates: {
      lat: Number(raw.coordinates?.lat) || 0,
      lng: Number(raw.coordinates?.lng) || 0,
      display: raw.coordinates?.display || 'Coordinates approximate'
    },
    elevation: raw.elevation || '—',
    yearBuilt: raw.yearBuilt || 'Historic era',
    archetype: raw.archetype || 'Historic Location',
    verified: false,
    liveGenerated: true,
    listenMinutes: Number(raw.listenMinutes) || 6,
    tagline: raw.tagline || `Uncovering the layered local story of ${name}.`,
    chapters,
    pulse: {
      summary: raw.pulse?.summary || 'Recent preservation and neighborhood context from public records.',
      highlights: Array.isArray(raw.pulse?.highlights) ? raw.pulse.highlights : []
    },
    funnel: {
      contextShare: Number(raw.funnel?.contextShare) || 35,
      localShare: Number(raw.funnel?.localShare) || 65,
      tiers: Array.isArray(raw.funnel?.tiers) ? raw.funnel.tiers : []
    },
    eras: Array.isArray(raw.eras) ? raw.eras : [],
    mapConfig: {
      title: raw.mapConfig?.title || `${name} Walking Map`,
      subtitle: raw.mapConfig?.subtitle || 'Closest-first neighborhood gems around the primary stop',
      anchor: {
        x: Number(raw.mapConfig?.anchor?.x) || 400,
        y: Number(raw.mapConfig?.anchor?.y) || 210,
        label: raw.mapConfig?.anchor?.label || name.slice(0, 28)
      },
      streets: Array.isArray(raw.mapConfig?.streets) && raw.mapConfig.streets.length
        ? raw.mapConfig.streets
        : [
            { type: 'main', label: 'MAIN CORRIDOR', x1: 40, y1: 176, x2: 760, y2: 176 },
            { type: 'cross', label: 'West Cross St', x1: 230, y1: 50, x2: 230, y2: 340 },
            { type: 'cross', label: 'East Cross St', x1: 570, y1: 50, x2: 570, y2: 340 }
          ],
      waterways: Array.isArray(raw.mapConfig?.waterways) ? raw.mapConfig.waterways : [],
      landmarks: Array.isArray(raw.mapConfig?.landmarks) ? raw.mapConfig.landmarks : [],
      scaleLabel: raw.mapConfig?.scaleLabel || '200 ft / ~60 m'
    },
    gems,
    trivia,
    sources: {
      consulted,
      digDeeper: Array.isArray(raw.sources?.digDeeper) ? raw.sources.digDeeper : []
    }
  };
}

// ---------------------------------------------------------------------------
// Upstream AI callers (Gemini 2.5 Flash w/ Google Search, OpenAI fallback)
// ---------------------------------------------------------------------------
async function exploreWithGemini(query) {
  const apiKey = process.env.GEMINI_API_KEY.trim();
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: buildExplorerPrompt(query) }]
      }
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.45
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API HTTP ${response.status}: ${errText.slice(0, 240)}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('\n').trim();
    const parsed = extractJsonObject(text);

    // Pull verified web grounding links from Google Search metadata
    const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];
    const groundingSources = groundingChunks
      .filter((chunk) => chunk?.web?.uri)
      .slice(0, 8)
      .map((chunk) => ({
        title: chunk.web.title || 'Google Search Grounded Source',
        detail: 'Live web reference retrieved during Gemini 2.5 Flash archival grounding.',
        url: chunk.web.uri
      }));

    return {
      stop: normalizeStop(parsed, query, groundingSources),
      provider: `Gemini (${model} + Google Search)`
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function exploreWithOpenAI(query) {
  const apiKey = process.env.OPENAI_API_KEY.trim();
  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const payload = {
    model,
    response_format: { type: 'json_object' },
    temperature: 0.45,
    messages: [
      {
        role: 'system',
        content:
          'You are an archival local historian. Always respond with a single valid JSON object matching the user schema.'
      },
      {
        role: 'user',
        content: buildExplorerPrompt(query)
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API HTTP ${response.status}: ${errText.slice(0, 240)}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(text);

    return {
      stop: normalizeStop(parsed, query),
      provider: `OpenAI (${model})`
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request payload too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let cleanPath = pathname === '/' ? '/index.html' : pathname;
  try {
    cleanPath = decodeURIComponent(cleanPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  const resolvedPath = path.resolve(PUBLIC_DIR, '.' + cleanPath);
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for unknown non-API GET routes
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (fallbackErr, content) => {
        if (fallbackErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheHeader = ext === '.html' ? 'no-cache' : 'public, max-age=300';

    fs.readFile(resolvedPath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': cacheHeader
      });
      res.end(data);
    });
  });
}

// ---------------------------------------------------------------------------
// Main Request Router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = reqUrl;

  // Health Check (used by Render Blueprint)
  if (req.method === 'GET' && pathname === '/api/health') {
    const providers = getProviderStatus();
    return sendJson(res, 200, {
      status: 'ok',
      app: 'Wayfinder Archive — Location History Explorer',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      seededStops: SEEDED_STOPS.length,
      providers
    });
  }

  // Pre-seeded stops endpoint
  if (req.method === 'GET' && pathname === '/api/stops') {
    return sendJson(res, 200, {
      defaultStopId: SEEDED_STOPS[0]?.id || null,
      providers: getProviderStatus(),
      stops: SEEDED_STOPS
    });
  }

  // Live or seeded location exploration
  if (req.method === 'POST' && pathname === '/api/explore') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const query = String(body.query || '').trim();
    const forceLive = Boolean(body.forceLive);

    if (!query) {
      return sendJson(res, 400, {
        error: 'Please enter a street address, building, restaurant, or landmark to explore.'
      });
    }

    // Check verified pre-seeded archive first (unless forceLive is explicitly set)
    const seededMatch = !forceLive ? findMatchingSeededStop(query) : null;
    if (seededMatch) {
      return sendJson(res, 200, {
        mode: 'seeded',
        source: 'Wayfinder Verified Archive',
        notice: null,
        requestedQuery: query,
        stop: seededMatch
      });
    }

    const providers = getProviderStatus();

    // Try Gemini 2.5 Flash (with Google Search grounding) first
    if (providers.gemini) {
      try {
        const result = await exploreWithGemini(query);
        return sendJson(res, 200, {
          mode: 'live',
          source: result.provider,
          notice: null,
          requestedQuery: query,
          stop: result.stop
        });
      } catch (err) {
        console.error('[wayfinder] Gemini lookup error:', err.message);
        if (!providers.openai) {
          return sendJson(res, 200, {
            mode: 'fallback',
            source: 'Wayfinder Pre-Seeded Preview',
            notice: `Live lookup for "${query}" encountered a temporary Gemini API issue (${err.message}). Showing our verified flagship dossier for Beau Jo's Idaho Springs so you can keep exploring.`,
            requestedQuery: query,
            stop: SEEDED_STOPS[0]
          });
        }
      }
    }

    // Fallback to OpenAI if configured
    if (providers.openai) {
      try {
        const result = await exploreWithOpenAI(query);
        return sendJson(res, 200, {
          mode: 'live',
          source: result.provider,
          notice: null,
          requestedQuery: query,
          stop: result.stop
        });
      } catch (err) {
        console.error('[wayfinder] OpenAI lookup error:', err.message);
        return sendJson(res, 200, {
          mode: 'fallback',
          source: 'Wayfinder Pre-Seeded Preview',
          notice: `Live lookup for "${query}" encountered a temporary OpenAI API issue (${err.message}). Showing our verified flagship dossier for Beau Jo's Idaho Springs instead.`,
          requestedQuery: query,
          stop: SEEDED_STOPS[0]
        });
      }
    }

    // Graceful HTTP 200 fallback when neither API key is configured yet
    return sendJson(res, 200, {
      mode: 'fallback',
      source: 'Wayfinder Pre-Seeded Preview',
      notice: `Live lookups for "${query}" aren't enabled on this server yet because neither GEMINI_API_KEY nor OPENAI_API_KEY is configured. Add a free GEMINI_API_KEY in Render (or your local .env file) to research any address on Earth with Google Search grounding—meanwhile, explore our full verified Beau Jo's Idaho Springs dossier below!`,
      requestedQuery: query,
      stop: SEEDED_STOPS[0]
    });
  }

  // Static files for GET/HEAD
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  sendJson(res, 405, { error: 'Method Not Allowed' });
});

server.listen(PORT, HOST, () => {
  const providers = getProviderStatus();
  console.log(`\n🧭 Wayfinder Archive — Location History Explorer`);
  console.log(`   Listening on: http://${HOST}:${PORT}`);
  console.log(`   Seeded stops: ${SEEDED_STOPS.length}`);
  console.log(
    `   Live AI mode: ${
      providers.liveSearchReady
        ? providers.activeProvider.toUpperCase()
        : 'Preview fallback (set GEMINI_API_KEY or OPENAI_API_KEY to enable live lookups)'
    }\n`
  );
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
