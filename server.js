const express = require('express');
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { promisify } = require('util');

const app = express();
const PORT = 3001;
const DATA_FILE = path.join(__dirname, 'data', 'sources.json');
const CACHE_FILE = path.join(__dirname, 'data', 'cache.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    sources: [
      { id: '1', name: 'in-muenchen.de', url: 'https://www.in-muenchen.de/stadtleben/public-viewing-muenchen.html', enabled: true },
      { id: '2', name: 'backstage.eu', url: 'https://www.backstage.eu', enabled: true }
    ]
  }, null, 2));
}

function loadSources() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
function saveSources(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (Date.now() - cache.timestamp < 3600000) return cache.venues;
    } catch (e) {}
  }
  return null;
}

function saveCache(venues) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), venues }, null, 2));
}

// Seed data scraped from in-muenchen.de and backstage.eu (June 2026)
const SEED_VENUES = [
  { name: 'Axel F.', address: 'Dachauer Str. 185, 80637 München', details: 'Alle Deutschland-Spiele werden hier übertragen. Täglich ab 11:00 Uhr.', source: 'in-muenchen.de', lat: 48.1567, lng: 11.5388 },
  { name: 'Backstage München', address: 'Reitknechtstr. 6, 80639 München', details: 'Bis zu sieben Viewing-Bereiche indoor/outdoor. Reservierungstickets inkl. Sitzplatz und Getränke (1 Maß oder 2 Softdrinks). Ab 18:00.', source: 'backstage.eu', lat: 48.1483, lng: 11.5280 },
  { name: 'Bamberger Haus', address: 'Brunnerstr. 2, 80804 München', details: 'Biergarten-Viewing. Mo-Fr ab 15:00, Sa-So ab 12:00. Reservierung mit Brotzeitbrettl.', source: 'in-muenchen.de', lat: 48.1730, lng: 11.5725 },
  { name: 'Champions Bar', address: 'Berliner Str. 93, 80805 München', details: '12 Screens/Projektoren. Spezialmenü mit kanadischer, amerikanischer, mexikanischer Küche. Täglich ab 17:30.', source: 'in-muenchen.de', lat: 48.1730, lng: 11.5880 },
  { name: 'D!NGS', address: 'Sendlinger-Tor-Platz 11, 80336 München', details: 'Ehemaliges Kino. DFB-Spiele am 14., 20. und 25. Juni. Ab 17:00 oder 20:00.', source: 'in-muenchen.de', lat: 48.1340, lng: 11.5670 },
  { name: 'Fraunhofer München', address: 'Fraunhoferstr. 9, 80469 München', details: 'Biergarten und Indoor-Viewing. Reservierung unter 089/266460. Ab 17:30.', source: 'in-muenchen.de', lat: 48.1290, lng: 11.5760 },
  { name: 'Giesinger Bräu Schänke', address: 'Martin-Luther-Str. 2, 81539 München', details: 'Viele WM-Spiele. Volles Biersortiment. Di-Sa ab 18:00.', source: 'in-muenchen.de', lat: 48.1190, lng: 11.5780 },
  { name: 'Hirschgarten', address: 'Hirschgarten 1, 80639 München', details: 'Größter Biergarten der Stadt. DFB-Spiele mit Anstoß vor 23:00, Halbfinale, Spiel um Platz 3, Finale. Ab 11:00.', source: 'in-muenchen.de', lat: 48.1500, lng: 11.5200 },
  { name: 'Hopfendolde', address: 'Feilitzschstr. 17, 80802 München', details: 'Angenehm preisgünstig. Darts, Kicker, Billard, Karaoke. Ab 12:00.', source: 'in-muenchen.de', lat: 48.1640, lng: 11.5850 },
  { name: 'Kennedy\'s Bar & Restaurant', address: 'Sendlinger-Tor-Platz 11, 80336 München', details: 'HD-Qualität. Irish Pub mit Guinness, Kilkenny. Fingerfood-Baskets. Ab 11:30.', source: 'in-muenchen.de', lat: 48.1342, lng: 11.5668 },
  { name: 'Michaeligarten', address: 'Feichtstr. 10, 81735 München', details: '4,5 × 2,5m LED-Screen. Alle DFB-Spiele inkl. 22:00-Anstoß. Ab 12:00.', source: 'in-muenchen.de', lat: 48.1130, lng: 11.6200 },
  { name: 'Midnightbazar', address: 'Arnulfstr. 195-199, 80639 München', details: '15K-Projektionstechnik, ~300 Plätze. Einzelreservierung €7 (Sitzplatz + 2 Getränkegutscheine). Ab 16:00.', source: 'in-muenchen.de', lat: 48.1470, lng: 11.5260 },
  { name: 'Ned Kelly\'s Australian Bar', address: 'Frauenplatz 11, 80331 München', details: 'Internationales Publikum. Foster\'s, Guinness, Kilkenny. Fingerfood. Ab 16:00.', source: 'in-muenchen.de', lat: 48.1385, lng: 11.5735 },
  { name: 'Paulaner am Nockherberg', address: 'Hochstr. 77, 81541 München', details: 'Zwei große LED-Screens. Reservierter Bereich inkl. 10 Nockherberger. Start 14. Juni. Mo-Fr ab 16:00, Sa-So ab 12:00.', source: 'in-muenchen.de', lat: 48.1210, lng: 11.5850 },
  { name: 'Paulaner Brauhaus', address: 'Kapuzinerplatz 5, 80337 München', details: 'Biergarten + Indoor. SB-Bereich. Reservierter Bereich €23,50/Person (Brotzeit + 1 Maß). Mo-Fr ab 11:00.', source: 'in-muenchen.de', lat: 48.1270, lng: 11.5650 },
  { name: 'Paulaner Sportsbar Zum Stiftl', address: 'Prälat-Zistl-Str. 10, 80331 München', details: '14 Flatscreens. Konzession bis 5 Uhr. Halbe nur 3,90€. Ab 15:00.', source: 'in-muenchen.de', lat: 48.1365, lng: 11.5760 },
  { name: 'Quentin\'s Palmengarten', address: 'Bayerstr. 3-5, 80335 München', details: '12m² LED-Wand im Innenhof. Spritz-Kreationen, Weine, Bier, Snacks. Mo-Fr ab 17:00, Sa-So ab 12:00.', source: 'in-muenchen.de', lat: 48.1395, lng: 11.5650 },
  { name: 'Seehaus Biergarten', address: 'Kleinhesselohe 3, 80802 München', details: 'Am Kleinhesseloher See. 5×3m Outdoor-Screen. Free-TV-Spiele bis 22:00 Anstoß. Ab 11:30.', source: 'in-muenchen.de', lat: 48.1630, lng: 11.5900 },
  { name: 'Senatore Bar', address: 'Sendlinger-Tor-Platz 5, 80336 München', details: 'Terrasse bei gutem Wetter. Pizza und Drinks. Freier Eintritt. Dancefloor. Ab 18:00.', source: 'in-muenchen.de', lat: 48.1338, lng: 11.5672 },
  { name: 'Stadion an der Schleißheimer Straße', address: 'Schleißheimer Str. 82, 80797 München', details: 'Fußballmuseum mit Theke. Reservierung schnell ausgebucht. 20-25 Walk-ins. Goaßnmaß und Laterndlmaß.', source: 'in-muenchen.de', lat: 48.1560, lng: 11.5680 },
  { name: 'Tegernseer Tal Bräuhaus', address: 'Tal 8, 80331 München', details: 'Hochburg des Public Viewing. Fr-Sa bis 3:00, wochentags bis 1:00. Mo-Fr ab 11:00.', source: 'in-muenchen.de', lat: 48.1355, lng: 11.5800 },
  { name: 'Werksviertel-Mitte', address: 'Knödelplatz, 81671 München', details: 'Große LED-Wand, Food Trucks, nationenspezifische Angebote. Ab 11. Juni täglich ab 17:00.', source: 'in-muenchen.de', lat: 48.1270, lng: 11.6050 },
];

async function fetchWithRetry(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-DE,de;q=0.9',
      'Accept-Encoding': 'identity'
    },
    timeout: 10000
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseInMuenchen(html) {
  const $ = cheerio.load(html);
  const venues = [];
  const text = $('body').text();
  const addrRegex = /([A-ZÄÖÜa-zäöüß][a-zäöüß\-\.]+(?:str\.|straße|platz|garten|weg|allee)[^\d]*?\d+[a-z]?(?:\s*[-–]\s*\d+)?(?:\s*,?\s*\d{5}\s*München)?)/gi;
  let match;
  while ((match = addrRegex.exec(text)) !== null) {
    const addr = match[1].trim();
    const ctx = text.substring(Math.max(0, match.index - 150), Math.min(text.length, match.index + 200)).replace(/\s+/g, ' ');
    venues.push({ address: addr, details: ctx, source: 'in-muenchen.de' });
  }
  return venues;
}

function parseGeneric(html, sourceUrl) {
  const $ = cheerio.load(html);
  const venues = [];
  const hostname = new URL(sourceUrl).hostname;
  const text = $('body').text();
  const addrRegex = /([A-ZÄÖÜa-zäöüß][a-zäöüß\-\.]+(?:str\.|straße|platz|garten|weg|allee|ring|damm)[^\d]*?\d+[a-z]?(?:\s*[-–]\s*\d+)?(?:\s*,?\s*\d{5}\s*München)?)/gi;
  let match;
  while ((match = addrRegex.exec(text)) !== null) {
    const addr = match[1].trim();
    const ctx = text.substring(Math.max(0, match.index - 150), Math.min(text.length, match.index + 200)).replace(/\s+/g, ' ');
    if (ctx.toLowerCase().match(/public\s*viewing|wm|world\s*cup|fußball|football|live|übertragung|spiel/)) {
      venues.push({ address: addr, details: ctx, source: hostname });
    }
  }
  return venues;
}

async function scrapeSource(source) {
  try {
    const html = await fetchWithRetry(source.url);
    const hostname = new URL(source.url).hostname;
    if (hostname.includes('in-muenchen.de')) return parseInMuenchen(html);
    return parseGeneric(html, source.url);
  } catch (e) {
    console.log(`Scrape failed for ${source.url}: ${e.message} — using seed data`);
    return [];
  }
}

async function geocode(address) {
  try {
    const q = encodeURIComponent(address + (address.includes('München') ? '' : ', München, Germany'));
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
      headers: { 'User-Agent': 'WM2026-Munich-Viewer/1.0' }
    });
    const data = await res.json();
    if (data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch (e) {}
  return null;
}

// API Routes

app.get('/api/sources', (req, res) => res.json(loadSources()));

app.post('/api/sources', (req, res) => {
  const data = loadSources();
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  data.sources.push({ id: String(Date.now()), name, url, enabled: true });
  saveSources(data);
  res.json(data);
});

app.delete('/api/sources/:id', (req, res) => {
  const data = loadSources();
  data.sources = data.sources.filter(s => s.id !== req.params.id);
  saveSources(data);
  res.json(data);
});

app.patch('/api/sources/:id', (req, res) => {
  const data = loadSources();
  const source = data.sources.find(s => s.id === req.params.id);
  if (!source) return res.status(404).json({ error: 'not found' });
  Object.assign(source, req.body);
  saveSources(data);
  res.json(data);
});

app.get('/api/venues', async (req, res) => {
  const cached = loadCache();
  if (cached && !req.query.refresh) return res.json({ venues: cached, fromCache: true });

  const data = loadSources();
  const enabled = data.sources.filter(s => s.enabled);

  // Filter seed venues to only enabled sources
  const enabledHosts = new Set();
  for (const s of enabled) {
    const h = new URL(s.url).hostname.replace('www.', '');
    enabledHosts.add(h);
  }
  let venues = SEED_VENUES.filter(v => enabledHosts.has(v.source));

  saveCache(venues);
  res.json({ venues, fromCache: false });

  // Background: try live scraping for additional venues (results available on next refresh)
  scrapeInBackground(enabled, venues).catch(e => console.log('Background scrape error:', e.message));
});

async function scrapeInBackground(sources, existingVenues) {
  let newVenues = [];
  for (const source of sources) {
    try {
      const scraped = await scrapeSource(source);
      for (const sv of scraped) {
        const isDuplicate = [...existingVenues, ...newVenues].some(v =>
          v.address.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15) ===
          sv.address.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15)
        );
        if (!isDuplicate) {
          const coords = await geocode(sv.address);
          if (coords) {
            sv.lat = coords[0];
            sv.lng = coords[1];
            sv.name = sv.name || sv.address.split(',')[0];
            newVenues.push(sv);
            await new Promise(r => setTimeout(r, 1100));
          }
        }
      }
    } catch (e) {
      console.log(`Background scrape error for ${source.url}:`, e.message);
    }
  }
  if (newVenues.length > 0) {
    const all = [...existingVenues, ...newVenues];
    saveCache(all);
    console.log(`Background scrape found ${newVenues.length} new venues`);
  }
}

app.listen(PORT, () => {
  console.log(`WM 2026 Live Munich running at http://localhost:${PORT}`);
});
