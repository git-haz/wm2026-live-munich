#!/usr/bin/env python3
"""
Scrape WM 2026 public viewing venues in Munich and write venues.json.

Usage:
    python update_venues.py

Sources are read from sources.json. Results are written to venues.json
which is consumed by the static frontend.

Requires: pip install requests beautifulsoup4
"""

import json
import re
import time
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

SCRIPT_DIR = Path(__file__).parent
SOURCES_FILE = SCRIPT_DIR / "sources.json"
VENUES_FILE = SCRIPT_DIR / "venues.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "de-DE,de;q=0.9",
    "Accept-Encoding": "identity",
}

KNOWN_COORDS = {
    "dachauer str. 185": [48.1567, 11.5388],
    "reitknechtstr. 6": [48.1483, 11.5280],
    "brunnerstr. 2": [48.1730, 11.5725],
    "tegernseer landstr. 96": [48.1130, 11.5780],
    "berliner str. 93": [48.1730, 11.5880],
    "sendlinger-tor-platz 11": [48.1340, 11.5670],
    "fraunhoferstr. 9": [48.1290, 11.5760],
    "martin-luther-str. 2": [48.1190, 11.5780],
    "hirschgarten 1": [48.1500, 11.5200],
    "feilitzschstr. 17": [48.1640, 11.5850],
    "feichtstr. 10": [48.1130, 11.6200],
    "arnulfstr. 195-199": [48.1470, 11.5260],
    "frauenplatz 11": [48.1385, 11.5735],
    "hochstr. 77": [48.1210, 11.5850],
    "kapuzinerplatz 5": [48.1270, 11.5650],
    "prälat-zistl-str. 10": [48.1365, 11.5760],
    "bayerstr. 3-5": [48.1395, 11.5650],
    "kleinhesselohe 3": [48.1630, 11.5900],
    "sendlinger-tor-platz 5": [48.1338, 11.5672],
    "schleißheimer str. 82": [48.1560, 11.5680],
    "tal 8": [48.1355, 11.5800],
    "knödelplatz": [48.1270, 11.6050],
}

SEED_VENUES = [
    {"name": "Axel F.", "address": "Dachauer Str. 185, 80637 München", "details": "Alle Deutschland-Spiele werden hier übertragen. Täglich ab 11:00 Uhr.", "source": "in-muenchen.de", "lat": 48.1567, "lng": 11.5388},
    {"name": "Backstage München", "address": "Reitknechtstr. 6, 80639 München", "details": "Bis zu sieben Viewing-Bereiche indoor/outdoor. Reservierungstickets inkl. Sitzplatz und Getränke (1 Maß oder 2 Softdrinks). Ab 18:00.", "source": "backstage.eu", "lat": 48.1483, "lng": 11.528},
    {"name": "Bamberger Haus", "address": "Brunnerstr. 2, 80804 München", "details": "Biergarten-Viewing. Mo-Fr ab 15:00, Sa-So ab 12:00. Reservierung mit Brotzeitbrettl.", "source": "in-muenchen.de", "lat": 48.173, "lng": 11.5725},
    {"name": "Champions Bar", "address": "Berliner Str. 93, 80805 München", "details": "12 Screens/Projektoren. Spezialmenü mit kanadischer, amerikanischer, mexikanischer Küche. Täglich ab 17:30.", "source": "in-muenchen.de", "lat": 48.173, "lng": 11.588},
    {"name": "D!NGS", "address": "Sendlinger-Tor-Platz 11, 80336 München", "details": "Ehemaliges Kino. DFB-Spiele am 14., 20. und 25. Juni. Ab 17:00 oder 20:00.", "source": "in-muenchen.de", "lat": 48.134, "lng": 11.567},
    {"name": "Fraunhofer München", "address": "Fraunhoferstr. 9, 80469 München", "details": "Biergarten und Indoor-Viewing. Reservierung unter 089/266460. Ab 17:30.", "source": "in-muenchen.de", "lat": 48.129, "lng": 11.576},
    {"name": "Giesinger Bräu Schänke", "address": "Martin-Luther-Str. 2, 81539 München", "details": "Viele WM-Spiele. Volles Biersortiment. Di-Sa ab 18:00.", "source": "in-muenchen.de", "lat": 48.119, "lng": 11.578},
    {"name": "Hirschgarten", "address": "Hirschgarten 1, 80639 München", "details": "Größter Biergarten der Stadt. DFB-Spiele mit Anstoß vor 23:00, Halbfinale, Spiel um Platz 3, Finale. Ab 11:00.", "source": "in-muenchen.de", "lat": 48.15, "lng": 11.52},
    {"name": "Hopfendolde", "address": "Feilitzschstr. 17, 80802 München", "details": "Angenehm preisgünstig. Darts, Kicker, Billard, Karaoke. Ab 12:00.", "source": "in-muenchen.de", "lat": 48.164, "lng": 11.585},
    {"name": "Kennedy's Bar & Restaurant", "address": "Sendlinger-Tor-Platz 11, 80336 München", "details": "HD-Qualität. Irish Pub mit Guinness, Kilkenny. Fingerfood-Baskets. Ab 11:30.", "source": "in-muenchen.de", "lat": 48.1342, "lng": 11.5668},
    {"name": "Michaeligarten", "address": "Feichtstr. 10, 81735 München", "details": "4,5 × 2,5m LED-Screen. Alle DFB-Spiele inkl. 22:00-Anstoß. Ab 12:00.", "source": "in-muenchen.de", "lat": 48.113, "lng": 11.62},
    {"name": "Midnightbazar", "address": "Arnulfstr. 195-199, 80639 München", "details": "15K-Projektionstechnik, ~300 Plätze. Einzelreservierung €7 (Sitzplatz + 2 Getränkegutscheine). Ab 16:00.", "source": "in-muenchen.de", "lat": 48.147, "lng": 11.526},
    {"name": "Ned Kelly's Australian Bar", "address": "Frauenplatz 11, 80331 München", "details": "Internationales Publikum. Foster's, Guinness, Kilkenny. Fingerfood. Ab 16:00.", "source": "in-muenchen.de", "lat": 48.1385, "lng": 11.5735},
    {"name": "Paulaner am Nockherberg", "address": "Hochstr. 77, 81541 München", "details": "Zwei große LED-Screens. Reservierter Bereich inkl. 10 Nockherberger. Start 14. Juni. Mo-Fr ab 16:00, Sa-So ab 12:00.", "source": "in-muenchen.de", "lat": 48.121, "lng": 11.585},
    {"name": "Paulaner Brauhaus", "address": "Kapuzinerplatz 5, 80337 München", "details": "Biergarten + Indoor. SB-Bereich. Reservierter Bereich €23,50/Person (Brotzeit + 1 Maß). Mo-Fr ab 11:00.", "source": "in-muenchen.de", "lat": 48.127, "lng": 11.565},
    {"name": "Paulaner Sportsbar Zum Stiftl", "address": "Prälat-Zistl-Str. 10, 80331 München", "details": "14 Flatscreens. Konzession bis 5 Uhr. Halbe nur 3,90€. Ab 15:00.", "source": "in-muenchen.de", "lat": 48.1365, "lng": 11.576},
    {"name": "Quentin's Palmengarten", "address": "Bayerstr. 3-5, 80335 München", "details": "12m² LED-Wand im Innenhof. Spritz-Kreationen, Weine, Bier, Snacks. Mo-Fr ab 17:00, Sa-So ab 12:00.", "source": "in-muenchen.de", "lat": 48.1395, "lng": 11.565},
    {"name": "Seehaus Biergarten", "address": "Kleinhesselohe 3, 80802 München", "details": "Am Kleinhesseloher See. 5×3m Outdoor-Screen. Free-TV-Spiele bis 22:00 Anstoß. Ab 11:30.", "source": "in-muenchen.de", "lat": 48.163, "lng": 11.59},
    {"name": "Senatore Bar", "address": "Sendlinger-Tor-Platz 5, 80336 München", "details": "Terrasse bei gutem Wetter. Pizza und Drinks. Freier Eintritt. Dancefloor. Ab 18:00.", "source": "in-muenchen.de", "lat": 48.1338, "lng": 11.5672},
    {"name": "Stadion an der Schleißheimer Straße", "address": "Schleißheimer Str. 82, 80797 München", "details": "Fußballmuseum mit Theke. Reservierung schnell ausgebucht. 20-25 Walk-ins. Goaßnmaß und Laterndlmaß.", "source": "in-muenchen.de", "lat": 48.156, "lng": 11.568},
    {"name": "Tegernseer Tal Bräuhaus", "address": "Tal 8, 80331 München", "details": "Hochburg des Public Viewing. Fr-Sa bis 3:00, wochentags bis 1:00. Mo-Fr ab 11:00.", "source": "in-muenchen.de", "lat": 48.1355, "lng": 11.58},
    {"name": "Werksviertel-Mitte", "address": "Knödelplatz, 81671 München", "details": "Große LED-Wand, Food Trucks, nationenspezifische Angebote. Ab 11. Juni täglich ab 17:00.", "source": "in-muenchen.de", "lat": 48.127, "lng": 11.605},
]

ADDR_REGEX = re.compile(
    r"([A-ZÄÖÜa-zäöüß][a-zäöüß\-\.]+(?:str\.|straße|platz|garten|weg|allee)[^\d]*?\d+[a-z]?"
    r"(?:\s*[-–]\s*\d+)?(?:\s*,?\s*\d{5}\s*München)?)",
    re.IGNORECASE,
)


def geocode(address: str) -> list[float] | None:
    key = re.sub(r",?\s*\d{5}\s*münchen", "", address.lower()).strip()
    for known, coords in KNOWN_COORDS.items():
        if known in key or key in known:
            return coords
    try:
        q = address if "münchen" in address.lower() else address + ", München, Germany"
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": 1},
            headers={"User-Agent": "WM2026-Munich-Viewer/1.0"},
            timeout=10,
        )
        data = r.json()
        if data:
            return [float(data[0]["lat"]), float(data[0]["lon"])]
    except Exception as e:
        print(f"  Geocoding failed for {address}: {e}", file=sys.stderr)
    return None


def fetch_html(url: str) -> str | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"  Fetch failed for {url}: {e}", file=sys.stderr)
        return None


def parse_addresses_from_html(html: str, source: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    venues = []
    for m in ADDR_REGEX.finditer(text):
        addr = m.group(1).strip()
        ctx = text[max(0, m.start() - 150) : m.start() + 200].replace("\n", " ").strip()
        if re.search(r"public\s*viewing|wm|world\s*cup|fußball|football|live|übertragung|spiel", ctx, re.I):
            venues.append({"address": addr, "details": ctx[:300], "source": source})
    return venues


def deduplicate(venues: list[dict]) -> list[dict]:
    seen = {}
    for v in venues:
        key = re.sub(r"[^a-z0-9]", "", v["address"].lower())[:15]
        if key not in seen or len(v.get("details", "")) > len(seen[key].get("details", "")):
            seen[key] = v
    return list(seen.values())


def main():
    sources = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))["sources"]
    enabled = [s for s in sources if s.get("enabled", True)]

    venues = list(SEED_VENUES)
    print(f"Seed: {len(venues)} venues")

    for source in enabled:
        hostname = urlparse(source["url"]).hostname.replace("www.", "")
        print(f"Scraping {source['url']}...")
        html = fetch_html(source["url"])
        if not html:
            print(f"  Skipped (fetch failed)")
            continue

        scraped = parse_addresses_from_html(html, hostname)
        new_count = 0
        for sv in scraped:
            is_dup = any(
                re.sub(r"[^a-z0-9]", "", v["address"].lower())[:15]
                == re.sub(r"[^a-z0-9]", "", sv["address"].lower())[:15]
                for v in venues
            )
            if is_dup:
                continue
            coords = geocode(sv["address"])
            if coords:
                sv["lat"] = coords[0]
                sv["lng"] = coords[1]
                sv["name"] = sv.get("name") or sv["address"].split(",")[0]
                venues.append(sv)
                new_count += 1
                time.sleep(1.1)
        print(f"  Found {len(scraped)} addresses, {new_count} new venues")

    venues = deduplicate(venues)
    venues = [v for v in venues if v.get("lat") and v.get("lng")]

    output = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "venues": venues,
    }
    VENUES_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(venues)} venues to {VENUES_FILE}")


if __name__ == "__main__":
    main()
