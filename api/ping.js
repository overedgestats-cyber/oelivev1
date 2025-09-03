module.exports = (req, res) => {
  res.status(200).json({ ok: true });
};
module.exports.config = { runtime: "nodejs22.x" };
