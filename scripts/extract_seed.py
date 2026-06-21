#!/usr/bin/env python3
"""Extract enriched seed attributes from the Excel into data/seed_attributes.json.

The Excel (docs/Seattle_Restaurants_Enriched.xlsx) is *seed input*, not a runtime
store. This one-time step lifts the editorial attributes (description, vibe tags,
price tier, dietary flags, reservation, etc.) into a checked-in JSON keyed by a
normalized restaurant name, which src/catalog/buildCatalog.ts merges with menu/*.json.

Run:  python3 scripts/extract_seed.py
Pure stdlib — no external deps (xlsx is just a zip of XML).
"""
import json, re, html, zipfile, unicodedata, os

XLSX = "docs/Seattle_Restaurants_Enriched.xlsx"
OUT = "data/seed_attributes.json"


def norm_name(s: str) -> str:
    """Lowercase, strip accents and non-alphanumerics for fuzzy name matching."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def col_index(ref: str) -> int:
    letters = re.match(r"([A-Z]+)", ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def main() -> None:
    z = zipfile.ZipFile(XLSX)
    shared = [
        html.unescape(t)
        for t in re.findall(r"<t[^>]*>(.*?)</t>", z.read("xl/sharedStrings.xml").decode("utf-8"), re.S)
    ]

    def parse_row(rowxml: str) -> list[str]:
        cells: dict[int, str] = {}
        for m in re.finditer(r"<c\b([^>]*?)(?:/>|>(.*?)</c>)", rowxml, re.S):
            attrs, inner = m.group(1), m.group(2) or ""
            ref = re.search(r'r="([A-Z]+\d+)"', attrs)
            if not ref:
                continue
            ci = col_index(ref.group(1))
            t = re.search(r't="(\w+)"', attrs)
            v = re.search(r"<v>(.*?)</v>", inner, re.S)
            val = v.group(1) if v else ""
            if t and t.group(1) == "s" and val != "":
                val = shared[int(val)]
            cells[ci] = html.unescape(val)
        maxc = max(cells) if cells else -1
        return [cells.get(i, "") for i in range(maxc + 1)]

    data = z.read("xl/worksheets/sheet2.xml").decode("utf-8")
    rows = re.findall(r"<row[^>]*>(.*?)</row>", data, re.S)
    header = parse_row(rows[1])  # row 0 is a title banner; row 1 is the header
    idx = {h: i for i, h in enumerate(header)}

    def g(cells: list[str], key: str) -> str:
        i = idx.get(key)
        return cells[i].strip() if i is not None and i < len(cells) else ""

    def price_tier(s: str):
        n = s.count("$")
        return n if 1 <= n <= 4 else None

    def yn(s: str) -> bool:
        return s.strip().upper().startswith("Y")

    def tags(s: str) -> list[str]:
        return [t.strip() for t in re.split(r"[;,]", s) if t.strip()]

    def num(s: str):
        m = re.search(r"-?\d+(\.\d+)?", s)
        return float(m.group(0)) if m else None

    out: dict[str, dict] = {}
    for r in rows[2:]:
        c = parse_row(r)
        name = g(c, "Restaurant Name *")
        if not name:
            continue
        dns = num(g(c, "Date-Night Score (1-5)"))
        out[norm_name(name)] = {
            "name": name,
            "neighborhood": g(c, "Neighborhood *") or None,
            "website_url": g(c, "Website URL *") or None,
            "cuisine_primary": g(c, "Cuisine (Primary)") or None,
            "cuisine_secondary": g(c, "Cuisine (Secondary)") or None,
            "price_tier": price_tier(g(c, "Price Tier")),
            "tags": tags(g(c, "Tags (your notes)")),
            "description": g(c, "Description") or None,
            "venue_type": g(c, "Venue Type") or None,
            "reservations": g(c, "Reservations") or None,
            "reservation_platform": g(c, "Reservation Platform") or None,
            "serves_vegetarian": yn(g(c, "Vegetarian")),
            "serves_vegan": yn(g(c, "Vegan")),
            "serves_gluten_free": yn(g(c, "Gluten-Free")),
            "ambiance_tags": tags(g(c, "Ambiance Tags")),
            "noise_level": g(c, "Noise Level") or None,
            "date_night_score": int(dns) if dns is not None else None,
            "hero_dishes": [d for d in [g(c, "Hero Dish 1"), g(c, "Hero Dish 2")] if d],
            "latitude": num(g(c, "Latitude")),
            "longitude": num(g(c, "Longitude")),
            "verified_at": g(c, "Verified Date") or None,
            "enrichment_status": g(c, "Enrichment Status") or None,
        }

    os.makedirs("data", exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"wrote {OUT}: {len(out)} seed rows")


if __name__ == "__main__":
    main()
