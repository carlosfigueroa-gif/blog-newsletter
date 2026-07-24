/**
 * Vendoo blog digest — platform-agnostic core.
 * ------------------------------------------------------------------
 * Returns the PREVIOUS full calendar month's published blog posts as
 * compact JSON. Extracted from the HubSpot serverless function so the
 * same logic can run on any Node 18+ serverless host (Vercel, Cloudflare,
 * Netlify, Lambda). Each host only needs a thin adapter that calls
 * getDigest() and maps the returned { statusCode, body } onto its own
 * response object.
 *
 * Uses the built-in global fetch (Node 18+), so there are no dependencies.
 *
 * Secrets (provided by the host adapter, never hardcoded):
 *   - token       : HubSpot private app token, CMS/blog content read scope
 *   - expectedKey : the configured DIGEST_KEY (shared secret)
 */

const HUBSPOT_API = 'https://api.hubapi.com/cms/v3/blogs/posts';
const UTM = 'utm_source=braze&utm_medium=email&utm_campaign=blog_digest';

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function withUtm(url) {
  if (!url) return '';
  return url + (url.indexOf('?') !== -1 ? '&' : '?') + UTM;
}

// Trim to a whole-word excerpt at or under `max` chars, adding an ellipsis only
// when the text was actually shortened — so we never cut mid-word (e.g. the old
// "...products with stron") or dangle an ellipsis on an already-complete summary.
function excerpt(text, max) {
  const s = stripHtml(text);
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[\s….,;:!?"'—–-]+$/, '');
  return cut + '…';
}

/**
 * @param {object} opts
 * @param {string} opts.token        HubSpot private app token (CMS content read scope)
 * @param {string} opts.expectedKey  the configured DIGEST_KEY (shared secret)
 * @param {string} opts.providedKey  the ?key=... value supplied by the caller
 * @param {Date}   [opts.now]        clock injection point (defaults to current time)
 * @returns {Promise<{statusCode: number, body: object}>}
 */
async function getDigest({ token, expectedKey, providedKey, now = new Date() }) {
  // 1) Shared-secret gate.
  if (!expectedKey || providedKey !== expectedKey) {
    return { statusCode: 401, body: { error: 'unauthorized', posts: [] } };
  }

  // 2) Previous full calendar month in UTC: [prevMonthStart, currentMonthStart)
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const prevMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);

  try {
    // 3) Page through published posts (newest first), bounded on the low end
    //    by the API filter; the high end is filtered in code below.
    const collected = [];
    let after;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const params = new URLSearchParams({
        state: 'PUBLISHED',
        sort: '-publishDate',
        limit: '100',
        publishDate__gte: String(prevMonthStart), // ms epoch
        // Best-effort field trim (ignored gracefully if unsupported on list):
        property: 'name,url,postSummary,metaDescription,featuredImage,publishDate'
      });
      if (after) params.set('after', after);

      // fetch has no native timeout, so abort after 8s.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let data;
      try {
        const resp = await fetch(`${HUBSPOT_API}?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });
        // Throw on non-2xx (e.g. 403 from a missing content read scope) so it
        // lands in the catch below and returns 500 fetch_failed.
        if (!resp.ok) throw new Error(`HubSpot API responded ${resp.status}`);
        data = await resp.json();
      } finally {
        clearTimeout(timeoutId);
      }

      const results = (data && data.results) || [];
      for (const p of results) {
        const ts = Date.parse(p.publishDate);
        if (ts >= prevMonthStart && ts < currentMonthStart) collected.push(p);
      }

      after = data && data.paging && data.paging.next && data.paging.next.after;
      if (!after || results.length === 0) break; // no more pages
    }

    // 4) Shape compact JSON for Braze (newest first).
    const posts = collected
      .sort((a, b) => Date.parse(b.publishDate) - Date.parse(a.publishDate))
      .map(p => ({
        title: p.name || '',
        url: withUtm(p.url),
        summary: excerpt(p.postSummary || p.metaDescription, 170),
        image: p.featuredImage || '',
        date: p.publishDate || ''
      }));

    return { statusCode: 200, body: { count: posts.length, posts } };
  } catch (err) {
    // Return 500 + empty list so the Braze template aborts rather than
    // sending an empty shell.
    return {
      statusCode: 500,
      body: { error: 'fetch_failed', detail: (err && err.message) || 'unknown', posts: [] }
    };
  }
}

module.exports = { getDigest, stripHtml, withUtm, excerpt };
