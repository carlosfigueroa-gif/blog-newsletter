# Vendoo Blog Digest — HubSpot serverless function

A HubSpot CMS serverless function that returns the **previous full calendar
month's** published blog posts as compact JSON. It is called by a Braze
Connected Content block on the 1st of each month to build the monthly blog
digest email.

## Layout

```
lib/
  blog-digest-core.js   # platform-agnostic digest logic (built-in fetch, no deps)
api/
  blog-digest.js        # Vercel adapter — GET /api/blog-digest (portable host)
blog.functions/
  blog-digest.js        # HubSpot serverless variant (requires Content Hub Enterprise)
  serverless.json       # design-manager serverless config
vendoo_blog_digest_braze_v2.html   # REFERENCE ONLY — Braze template (do not deploy)
```

## JSON contract

The endpoint returns the following shape. **Field names must not change** — the
Braze template reads them directly:

```json
{
  "count": 3,
  "posts": [
    { "title": "...", "url": "...", "summary": "...", "image": "...", "date": "..." }
  ]
}
```

## Deploy (HubSpot CLI, design-manager serverless format)

> **Prerequisite — Content Hub Enterprise.** CMS serverless functions are a
> HubSpot Content Hub (CMS Hub) **Enterprise**-only feature. On 2026-06-23 an
> `hs cms upload` to account `8731369` was rejected with *"This account or user
> does not have access to serverless functions"*, so the steps below cannot
> succeed on that account as-is. Before deploying, have a HubSpot admin confirm
> the account is on Content Hub Enterprise **and** that the deploying user has
> access — the error names both the account tier and the user as possible
> causes, so an admin's personal access key may succeed where a non-admin's
> does not. If Enterprise is unavailable, host the endpoint on another
> serverless platform (the function uses only the built-in `fetch`, so it is
> portable) and update the Braze template's endpoint URL accordingly.

These steps require interactive prompts (auth + secrets) and your HubSpot
credentials, so run them from a terminal where you can type the values in.
Secrets are entered **only** via `hs secrets add` — never hardcoded or printed.

```bash
# 1. Install the CLI
npm i -g @hubspot/cli

# 2. Authenticate (paste your personal access key when prompted)
hs init        # or: hs auth

# 3. Upload the function folder to the Design Manager file system
hs cms upload blog.functions blog.functions

# 4. Add the two secrets (you will be prompted for each value)
hs secrets add PRIVATE_APP_ACCESS_TOKEN   # HubSpot private app token, CMS content read scope
hs secrets add DIGEST_KEY                 # any long random shared secret

# 5. Endpoint URL (CMS domain + /_hcms/api/<endpoint>)
#    https://blog.vendoo.co/_hcms/api/blog-digest

# 6. Test (returns last month's posts as { count, posts })
curl "https://blog.vendoo.co/_hcms/api/blog-digest?key=<DIGEST_KEY>&portalid=8731369"
```

## Alternative deploy: Vercel (no Content Hub Enterprise)

Since account `8731369` cannot host HubSpot serverless functions, the same
logic also ships as a portable Vercel function: `api/blog-digest.js` (the
adapter) over `lib/blog-digest-core.js` (the shared logic). It uses only the
built-in `fetch`, so there are no dependencies. The `blog.functions/` copy
stays as a reference for if the account ever moves to Content Hub Enterprise.

This still needs a **HubSpot private app token** with blog/CMS content read
scope — a *Private Apps* credential (Settings → Integrations → Private Apps),
which is a different permission than Account & Billing, and is **not** a
personal access key. Set it, plus the shared secret, as Vercel env vars (never
committed):

```bash
# 1. Deploy with the Vercel CLI (or import the repo in the Vercel dashboard —
#    it auto-detects the api/ function with zero config).
npm i -g vercel
vercel                                                # link + first deploy

# 2. Add the two secrets as Production env vars (prompted; never committed).
vercel env add PRIVATE_APP_ACCESS_TOKEN production    # HubSpot private app token, blog/CMS read scope
vercel env add DIGEST_KEY production                  # any long random shared secret

# 3. Promote to production.
vercel --prod

# 4. Endpoint (no portalid — the private app token sets the account):
#    https://<your-project>.vercel.app/api/blog-digest?key=<DIGEST_KEY>

# 5. Test (returns last month's posts as { count, posts }).
curl "https://<your-project>.vercel.app/api/blog-digest?key=<DIGEST_KEY>"
```

Then point the Braze Connected Content block at the new URL (dropping
`&portalid=...`); the JSON contract is identical, so nothing else in the
template changes. Moving to Cloudflare Workers, Netlify, or AWS Lambda instead
is a thin adapter over the same `lib/blog-digest-core.js`.

**Why not the public RSS feed?** `blog.vendoo.co/rss.xml` needs no token, but it
is capped at 10 items (~13 days) and ignores a larger `?limit=`, so it cannot
cover a full prior month for a 1st-of-month digest. Complete coverage requires
the authenticated API (which paginates with a date filter). If a private app
token is truly unobtainable, the no-auth fallback is scraping the public
paginated blog listing — complete but brittle, and not implemented here.

## Notes / things to verify against the live API

- **Date filter:** `publishDate__gte` is sent as a millisecond epoch. The
  function also re-filters the upper bound (`< currentMonthStart`) in code, so
  the correct month is returned even if the API filter is loose.
- **Field selection:** the `property` param may be ignored by the list
  endpoint. That is fine — the function trims fields itself when mapping.
- **Pagination:** the function reads `paging.next.after`.
- **Sort:** `sort=-publishDate` requests newest-first; the function also
  re-sorts newest-first in code as a backstop.
- **403:** if the list call returns 403, add the CMS/blog content read scope to
  the private app and regenerate the token.
- **HTTP client:** `blog-digest.js` uses the runtime's built-in global `fetch`
  (available on `nodejs18.x`), so there is no npm dependency to bundle. Non-2xx
  responses (e.g. a 403 from a missing CMS/blog content read scope) are thrown
  and surface as a 500 `fetch_failed` with the status in `detail`.
