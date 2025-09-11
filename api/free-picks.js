// Free Picks. If API key not configured, return a friendly fallback list.
module.exports = async (_req, res) => {
  const hasKey = !!process.env.API_FOOTBALL_KEY;
  if (!hasKey) {
    return res.status(200).json({
      ok: true,
      picks: [
        { match: 'Example A vs Example B', prediction: 'Over 2.5', confidence: 68, league: 'Demo' },
        { match: 'Example C vs Example D', prediction: 'Under 2.5', confidence: 65, league: 'Demo' }
      ],
      note: 'Real data will appear once API_FOOTBALL_KEY is set in your environment.'
    });
  }

  // TODO: Replace with your real logic. Keep response shape the same.
  return res.status(200).json({
    ok: true,
    picks: [],
    note: 'API key detected; plug in your real picks logic here.'
  });
};
