# Vendoo Blog Digest — HubSpot serverless function

A HubSpot CMS serverless function that returns the **previous full calendar
month's** published blog posts as compact JSON. It is called by a Braze
Connected Content block on the 1st of each month to build the monthly blog
digest email.

## Layout

```
blog.functions/
  blog-digest.js     # the serverless function
  serverless.json    # design-manager serverless config
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
- **`axios` dependency:** `blog-digest.js` requires `axios`. If the serverless
  runtime does not bundle it, the function will fail to load — switch to the
  built-in global `fetch` (available on the `nodejs18.x` runtime) with the same
  logic. Verify on the first deploy.
