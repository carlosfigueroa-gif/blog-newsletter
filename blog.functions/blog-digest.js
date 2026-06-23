const axios = require('axios');

/**
 * Vendoo blog digest endpoint (HubSpot serverless function)
 * -----------------------------------------------------------------
 * Returns the PREVIOUS full calendar month's published blog posts as
 * compact JSON. Designed to be called by Braze Connected Content on the
 * 1st of each month (e.g. a July 1 call returns June 1-30 posts).
 *
 * Secrets (added via `hs secrets add ...` and listed in serverless.json):
 *   - PRIVATE_APP_ACCESS_TOKEN : HubSpot private app token, CMS content read scope
 *   - DIGEST_KEY               : shared secret; caller must pass ?key=<DIGEST_KEY>
 *
 * Notes:
 *   - Window is computed in UTC. This is safe for US/UK account timezones.
 *     If the Braze account timezone is ever set far AHEAD of UTC (e.g. UTC+8)
 *     and sends fire early on the 1st, the window should be anchored to the
 *     account timezone instead — flag it and this can be adjusted.
 *   - HubSpot's combined publishDate__gte + publishDate__lte filter is
 *     unreliable, so only the lower bound is sent to the API; the upper
 *     bound (start of current month) is applied here in code.
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

exports.main = async (context, sendResponse) => {
  // 1) Shared-secret gate (query params arrive as arrays in HubSpot).
  const provided = (context.params && context.params.key && context.params.key[0]) || '';
  const expected = process.env.DIGEST_KEY || '';
  if (!expected || provided !== expected) {
    return sendResponse({ statusCode: 401, body: { error: 'unauthorized', posts: [] } });
  }

  const token = process.env.PRIVATE_APP_ACCESS_TOKEN;

  // 2) Previous full calendar month in UTC: [prevMonthStart, currentMonthStart)
  const now = new Date();
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const prevMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);

  try {
    // 3) Page through published posts (newest first), bounded on the low end
    //    by the API filter; the high end is filtered in code below.
    const collected = [];
    let after;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const params = {
        state: 'PUBLISHED',
        sort: '-publishDate',
        limit: 100,
        publishDate__gte: prevMonthStart, // ms epoch
        // Best-effort field trim (ignored gracefully if unsupported on list):
        property: 'name,url,postSummary,metaDescription,featuredImage,publishDate'
      };
      if (after) params.after = after;

      const resp = await axios.get(HUBSPOT_API, {
        headers: { Authorization: `Bearer ${token}` },
        params,
        timeout: 8000
      });

      const results = (resp.data && resp.data.results) || [];
      for (const p of results) {
        const ts = Date.parse(p.publishDate);
        if (ts >= prevMonthStart && ts < currentMonthStart) collected.push(p);
      }

      after = resp.data && resp.data.paging && resp.data.paging.next && resp.data.paging.next.after;
      if (!after || results.length === 0) break; // no more pages
    }

    // 4) Shape compact JSON for Braze (newest first).
    const posts = collected
      .sort((a, b) => Date.parse(b.publishDate) - Date.parse(a.publishDate))
      .map(p => ({
        title: p.name || '',
        url: withUtm(p.url),
        summary: stripHtml(p.postSummary || p.metaDescription).slice(0, 170),
        image: p.featuredImage || '',
        date: p.publishDate || ''
      }));

    return sendResponse({
      statusCode: 200,
      body: { count: posts.length, posts }
    });
  } catch (err) {
    // Return 500 + empty list so the Braze template aborts rather than
    // sending an empty shell.
    return sendResponse({
      statusCode: 500,
      body: { error: 'fetch_failed', detail: (err && err.message) || 'unknown', posts: [] }
    });
  }
};
