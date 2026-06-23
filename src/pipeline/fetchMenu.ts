// Stage 2 acquisition — get a menu page's text regardless of how it's published.
// - PDF  -> download + extract text with unpdf (pure JS, no system deps; no fetch size cap)
// - HTML -> render with headless Chromium (Playwright) to defeat JS shells + Cloudflare 403
// Returns the raw text; structuring into the schema is extractMenu.ts (a Claude call).

export type MenuKind = "html" | "pdf" | "pdf-scanned" | "error";

// When the text pipeline can't read a menu (image menu, scanned PDF), we hand the
// raw image(s)/PDF to the vision OCR path instead (extractMenuFromVision).
export interface VisionSource {
  kind: "image_url" | "pdf_doc";
  url?: string; // image_url: a menu image on the page (Sonnet fetches it)
  data?: string; // pdf_doc: base64 of a scanned PDF
}

export interface FetchedMenu {
  kind: MenuKind;
  text: string;
  final_url: string | null;
  note: string;
  vision?: VisionSource[]; // present when text was insufficient but images/PDF are available
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function looksLikePdf(url: string, contentType: string | null): boolean {
  return /\.pdf(\?|$)/i.test(url) || (contentType ?? "").includes("application/pdf");
}

async function fetchPdfText(url: string): Promise<FetchedMenu> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) return { kind: "error", text: "", final_url: res.url, note: `pdf http ${res.status}` };
  const buf = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocumentProxy(buf);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const clean = (Array.isArray(text) ? text.join("\n") : text).replace(/\s+\n/g, "\n").trim();
  if (clean.replace(/\s/g, "").length < 80) {
    // No text layer — hand the PDF bytes to the vision OCR path.
    return {
      kind: "pdf-scanned",
      text: clean,
      final_url: res.url,
      note: `${totalPages}p, no text layer (scanned -> vision OCR)`,
      vision: [{ kind: "pdf_doc", data: Buffer.from(buf).toString("base64") }],
    };
  }
  return { kind: "pdf", text: clean, final_url: res.url, note: `${totalPages}p text PDF` };
}

// A page with real menu data has many prices; a hub/landing page does not. Count
// $-prices, decimal prices (14.00 / 9.50), and bare 2-digit prices at line ends.
function countPrices(text: string): number {
  return (text.match(/\$\s?\d|\b\d{1,3}\.\d{2}\b|\b\d{2}\b\s*$/gm) || []).length;
}
// Threshold of 8 (not 6) so a landing page with a few incidental prices — a gift /
// merch / cocktail-mixer shop is common on restaurant homepages — isn't mistaken for
// the menu, which would short-circuit the deep-follow. Real à la carte menus carry
// far more (Six Seven 53 dishes, Barking Dog 66); a genuinely tiny menu still falls
// back to its own page text after the follow finds nothing better.
function looksLikeMenu(text: string): boolean {
  return text.length > 1200 && countPrices(text) >= 8;
}

// Rank "go to the dinner menu" links on a hub page. Returns absolute URLs best-first.
// Anchors expose `.href` already resolved to absolute, so relative ("/menus") and
// client-route SPA links come through correctly.
async function findMenuLinks(page: import("playwright").Page): Promise<string[]> {
  const links = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a.textContent || "").trim().toLowerCase().slice(0, 40),
      }))
    )
    .catch(() => [] as { href: string; text: string }[]);

  const score = (l: { href: string; text: string }): number => {
    const s = `${l.text} ${l.href.toLowerCase()}`;
    // dead ends: social, reservations-only, ordering-account, non-dinner menus
    if (/facebook|instagram|twitter|x\.com|tiktok|yelp\.com|maps\.google|\/login|\/account|opentable|resy\.com|sevenrooms/.test(s))
      return -1;
    if (/brunch|lunch|drink|beverage|wine|cocktail|happy\s*hour|gift|event|catering|private/.test(s)) return -1;
    let sc = 0;
    if (/dinner\s*menu|food\s*menu|\bdinner\b/.test(s)) sc = 3;
    else if (/\bmenus?\b/.test(s)) sc = 2;
    // known menu hosts often carry the full priced menu — worth a follow
    if (/toasttab|popmenu|square\.site|clover\.com|spoton|bentobox|\/menu/.test(l.href.toLowerCase())) sc += 1;
    return sc;
  };

  const seen = new Set<string>();
  return links
    .filter((l) => /^https?:/.test(l.href))
    .map((l) => ({ href: l.href.split("#")[0]!, sc: score(l) }))
    .filter((x) => x.sc > 0 && !seen.has(x.href) && (seen.add(x.href), true))
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.href);
}

// Collect candidate menu-image URLs. Feeds the vision OCR fallback when a room
// publishes its menu as a JPG/PNG rather than HTML text. Reading live <img> state is
// unreliable on lazy galleries (Squarespace et al. swap currentSrc to a placeholder
// and lazy-UNLOAD off-screen images), so the primary source is the page HTML, where
// the real data-src/srcset URLs persist regardless of DOM load state. We strip the
// ?format=NNNw query to dedupe responsive variants and hit the full-res original.
async function findMenuImages(page: import("playwright").Page): Promise<string[]> {
  const html = await page.content().catch(() => "");
  const named = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/[^"'\s)]+?\.(?:png|jpe?g|webp)(?:\?[^"'\s)]*)?/gi)) {
    const stripped = m[0].split("?")[0]!;
    if (/menu|dinner|food/i.test(stripped)) named.add(stripped);
  }
  if (named.size) return [...named].slice(0, 5);

  // No menu-named image. Fall back only when there are 2+ large images (a scan
  // gallery) — a single big image is almost always a hero/logo, not a menu, and we
  // don't want to fire a vision call (and write a junk room) on every landing page.
  const bigs = await page
    .evaluate(() => {
      const out: { src: string; area: number }[] = [];
      document.querySelectorAll("img").forEach((node) => {
        const img = node as HTMLImageElement;
        const area = (img.naturalWidth || 0) * (img.naturalHeight || 0);
        const src = (img.currentSrc || img.src || "").split("?")[0] ?? "";
        if (area >= 360000 && /^https?:/.test(src)) out.push({ src, area });
      });
      const seen = new Set<string>();
      return out
        .sort((a, b) => b.area - a.area)
        .filter((x) => !seen.has(x.src) && (seen.add(x.src), true))
        .map((x) => x.src);
    })
    .catch(() => [] as string[]);
  return bigs.length >= 2 ? bigs.slice(0, 5) : [];
}

// Navigate + wait for a JS shell to actually hydrate, reveal collapsed/tabbed menu
// sections, then return the page's visible text plus any candidate menu images.
async function loadAndExtract(
  page: import("playwright").Page,
  url: string
): Promise<{ text: string; images: string[] }> {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Content-aware hydrate: wait until the body has real text (SPA shells render the
  // menu late), not a fixed sleep. Resolves in ~1-3s on most sites; caps at 12s.
  await page
    .waitForFunction(() => (document.body?.innerText || "").trim().length > 500, { timeout: 12000 })
    .catch(() => {});
  try {
    await page.waitForLoadState("networkidle", { timeout: 6000 });
  } catch {
    /* SPAs may hold connections open and never go idle */
  }
  // Reveal collapsed sections AND click in-page menu tabs (non-anchor, non-link
  // controls ONLY — never anchors or nav <li>s, which can navigate away before we
  // capture the page). Many SPA menus sit behind a "MENU"/"DINNER" tab on the page.
  await page
    .evaluate(() => {
      document
        .querySelectorAll('[aria-expanded="false"], .accordion, summary')
        .forEach((el) => (el as HTMLElement).click?.());
      const wants = (t: string) =>
        /\b(dinner|food|menu)\b/i.test(t) && !/wine|drink|brunch|lunch|gift|cater|reserv/i.test(t);
      document.querySelectorAll('button, [role="tab"], [role="button"]').forEach((el) => {
        // Skip anything that is (or wraps) a link — clicking it navigates.
        if (el.closest("a") || el.querySelector("a")) return;
        const t = (el.textContent || "").trim();
        if (t.length > 0 && t.length <= 24 && wants(t)) {
          try {
            (el as HTMLElement).click?.();
          } catch {
            /* ignore */
          }
        }
      });
    })
    .catch(() => {});
  await page.waitForTimeout(1200); // let revealed/clicked content paint
  void resp;
  const text = ((await page.evaluate(() => document.body?.innerText)) || "").replace(/\n{3,}/g, "\n\n").trim();
  const images = await findMenuImages(page);
  return { text, images };
}

// Render `url`; if it's a hub (no priced menu), follow the best menu link(s) up to
// `maxDepth` hops, reusing one browser page. Returns the first page that looks like
// a real menu, else the best text we saw. `visited` guards against cycles.
async function followForMenu(
  page: import("playwright").Page,
  url: string,
  depth: number,
  maxDepth: number,
  visited: Set<string>
): Promise<{ text: string; final_url: string; images: string[]; vision?: VisionSource[] } | null> {
  const key = url.split("#")[0]!;
  if (visited.has(key)) return null;
  visited.add(key);

  const { text, images } = await loadAndExtract(page, url).catch(() => ({ text: "", images: [] as string[] }));
  const final_url = page.url();
  if (looksLikeMenu(text)) return { text, final_url, images };
  if (depth >= maxDepth) return text.length > 200 || images.length ? { text, final_url, images } : null;

  const candidates = await findMenuLinks(page);
  // breadth tapers with depth: try a few from the hub, fewer deeper.
  const breadth = depth === 0 ? 3 : 2;
  for (const link of candidates.slice(0, breadth)) {
    if (visited.has(link.split("#")[0]!)) continue;
    if (looksLikePdf(link, null)) {
      const pdf = await fetchPdfText(link).catch(() => null);
      if (pdf && pdf.kind === "pdf") return { text: pdf.text, final_url: pdf.final_url ?? link, images: [] };
      // scanned PDF reached via a follow — carry its vision source up
      if (pdf && pdf.kind === "pdf-scanned" && pdf.vision)
        return { text: "", final_url: pdf.final_url ?? link, images: [], vision: pdf.vision };
      continue;
    }
    const sub = await followForMenu(page, link, depth + 1, maxDepth, visited);
    if (sub && (looksLikeMenu(sub.text) || sub.vision)) return sub;
  }
  // nothing priced downstream — surface the best text we have (the hub itself),
  // keeping any menu images we found for the vision fallback.
  return text.length > 200 || images.length ? { text, final_url, images } : null;
}

async function renderHtmlText(url: string): Promise<FetchedMenu> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { kind: "error", text: "", final_url: null, note: "playwright not installed" };
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      // --disable-dev-shm-usage avoids /dev/shm exhaustion crashes on small droplets.
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ userAgent: UA, viewport: { width: 1280, height: 1800 } });

    const result = await followForMenu(page, url, 0, 2, new Set());
    if (!result) {
      return { kind: "error", text: "", final_url: page.url(), note: `rendered but no usable content` };
    }
    // A scanned PDF reached via the follow already carries its vision source.
    if (result.vision?.length) {
      return { kind: "pdf-scanned", text: "", final_url: result.final_url, note: `scanned PDF via follow -> vision OCR`, vision: result.vision };
    }
    const priced = looksLikeMenu(result.text);
    if (priced) {
      return {
        kind: "html",
        text: result.text,
        final_url: result.final_url,
        note: `rendered menu (${result.text.length} chars, ${countPrices(result.text)} prices)`,
      };
    }
    // No priced text menu. If the page carried candidate menu images, hand them to
    // the vision OCR path; otherwise return the best-effort hub text.
    const out: FetchedMenu = {
      kind: "html",
      text: result.text,
      final_url: result.final_url,
      note: result.images.length
        ? `no priced text menu — ${result.images.length} candidate image(s) for vision OCR`
        : `hub/partial — no priced menu found (${result.text.length} chars)`,
    };
    if (result.images.length) out.vision = result.images.map((u) => ({ kind: "image_url", url: u }));
    return out;
  } catch (e) {
    return { kind: "error", text: "", final_url: null, note: `render error: ${e instanceof Error ? e.message.slice(0, 120) : e}` };
  } finally {
    await browser?.close();
  }
}

export async function fetchMenu(url: string): Promise<FetchedMenu> {
  // peek content-type cheaply (some PDF links lack a .pdf suffix)
  let contentType: string | null = null;
  try {
    const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
    contentType = head.headers.get("content-type");
    url = head.url || url;
  } catch {
    /* HEAD may be blocked; fall through to GET-based paths */
  }
  if (looksLikePdf(url, contentType)) return fetchPdfText(url);
  return renderHtmlText(url);
}
