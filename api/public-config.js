// /api/public-config.js
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.json({
    // safe to expose; comes from Vercel env
    stripePk: process.env.STRIPE_PUBLISHABLE_KEY || null
    // If you ever want to expose other PUBLIC config, add it here.
  });
};

module.exports.config = { runtime: 'nodejs20.x' };
