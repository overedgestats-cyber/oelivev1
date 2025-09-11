const { verify } = require('./_lib/admin');

module.exports = async (req, res) => {
  try {
    const u = await verify(req);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, uid: u.uid, email: u.email });
  } catch (e) {
    res.status(e.status || 401).json({ ok: false, error: e.message || String(e) });
  }
};
