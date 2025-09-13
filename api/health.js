module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    ts: new Date().toISOString()
  });
};
