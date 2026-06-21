// Stage 2 acquisition — get a menu page's text regardless of how it's published.
// - PDF  -> download + extract text with unpdf (pure JS, no system deps; no fetch size cap)
// - HTML -> render with headless Chromium (Playwright) to defeat JS shells + Cloudflare 403
// Returns the raw text; structuring into the schema is extractMenu.ts (a Claude call).

export type MenuKind = "html" | "pdf" | "pdf-scanned" | "error";

export interface FetchedMenu {
  kind: MenuKind;
  text: string;
  final_url: string | null;
  note: string;
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
    return { kind: "pdf-scanned", text: clean, final_url: res.url, note: `${totalPages}p, no text layer (scanned -> needs vision)` };
  }
  return { kind: "pdf", text: clean, final_url: res.url, note: `${totalPages}p text PDF` };
}

// A page with real menu data has many prices; a hub/landing page does not.
function looksLikeMenu(text: string): boolean {
  const prices = (text.match(/\$\s?\d|\b\d{2}\b\s*$/gm) || []).length;
  return text.length > 1500 && prices >= 6;
}

// Find the best "go to the dinner menu" link on a hub page (absolute URL or null).
async function findMenuLink(page: import("playwright").Page): Promise<string | null> {
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
    if (/brunch|lunch|drink|beverage|wine|cocktail|happy|gift|event|catering/.test(s)) return -1;
    if (/dinner\s*menu|food\s*menu|\bdinner\b/.test(s)) return 3;
    if (/\bmenu\b/.test(s)) return 2;
    return 0;
  };
  const best = links
    .filter((l) => l.href.startsWith("http"))
    .map((l) => ({ l, sc: score(l) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)[0];
  return best ? best.l.href : null;
}

async function renderHtmlText(url: string, depth = 0): Promise<FetchedMenu> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { kind: "error", text: "", final_url: null, note: "playwright not installed" };
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
    const page = await browser.newPage({ userAgent: UA, viewport: { width: 1280, height: 1800 } });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000); // let JS shells + Cloudflare challenges settle
    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch {
      /* ignore */
    }
    await page
      .evaluate(() => {
        document
          .querySelectorAll('[aria-expanded="false"], .accordion, summary')
          .forEach((el) => (el as HTMLElement).click?.());
      })
      .catch(() => {});
    await page.waitForTimeout(800);
    const text = ((await page.evaluate(() => document.body?.innerText)) || "").replace(/\n{3,}/g, "\n\n").trim();
    const status = resp?.status() ?? 0;

    // Hub page? Follow the best dinner-menu link once (PDF -> PDF path).
    if (!looksLikeMenu(text) && depth < 2) {
      const link = await findMenuLink(page);
      await browser.close();
      browser = undefined;
      if (link && looksLikePdf(link, null)) return fetchPdfText(link);
      if (link && link !== page.url()) return renderHtmlText(link, depth + 1);
      return { kind: text.length > 200 ? "html" : "error", text, final_url: url, note: `hub page, no menu link found (${text.length} chars, http ${status})` };
    }
    if (text.length < 200) {
      return { kind: "error", text, final_url: page.url(), note: `rendered but sparse (${text.length} chars, http ${status})` };
    }
    return { kind: "html", text, final_url: page.url(), note: `rendered (http ${status}, ${text.length} chars)` };
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
