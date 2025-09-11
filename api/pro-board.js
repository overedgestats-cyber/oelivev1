// Pro Board (gated). For now, returns a tiny stub so the gate is testable.
// (Hook up your model later.)
const { verify, hasActiveSub } = require('./_lib/admin');

module.exports = async (req, res) => {
  try {
    const user = await verify(req);
    if (!(await hasActiveSub(user.uid))) {
      return res.status(401).json({ ok: false, error: 'no_subscription' });
    }

    const items = [
      {
        fixtureId: 1,
        kickoff: new Date().toISOString(),
        competition: 'Sample League',
        home: 'OverEdge FC',
        away: 'Data United',
        topBets: [{ market: '1X2', pick: '1', confidence: 74 }]
      }
    ];
    res.status(200).json({ ok: true, items, computedAt: new Date().toISOString() });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || String(e) });
  }
};
