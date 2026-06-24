/**
 * Vercel serverless adapter for the Vendoo blog digest endpoint.
 * ------------------------------------------------------------------
 * Deploys (zero-config) at GET /api/blog-digest. Reads two env vars, set in
 * the Vercel project settings and never committed:
 *   - HUBSPOT_TOKEN : HubSpot Service Key (or legacy private app token) with
 *                     read-only CMS/blog content scope — sent as a Bearer token
 *   - DIGEST_KEY    : shared secret; caller must pass ?key=<DIGEST_KEY>
 *
 * Braze Connected Content calls:
 *   https://<your-project>.vercel.app/api/blog-digest?key=<DIGEST_KEY>
 * (No portalid needed — the credential determines the account.)
 */

const { getDigest } = require('../lib/blog-digest-core');

module.exports = async (req, res) => {
  // Vercel parses the query string; a repeated param arrives as an array.
  const raw = (req.query && req.query.key) || '';
  const providedKey = Array.isArray(raw) ? raw[0] : raw;

  const { statusCode, body } = await getDigest({
    token: process.env.HUBSPOT_TOKEN,
    expectedKey: process.env.DIGEST_KEY || '',
    providedKey
  });

  res.status(statusCode).json(body);
};
