export default async function handler(_req, res) {
  res.json({
    ok: true,
    hasKey: !!process.env.API_FOOTBALL_KEY,
    tz: process.env.API_FOOTBALL_TZ || 'Europe/London'
  });
}
