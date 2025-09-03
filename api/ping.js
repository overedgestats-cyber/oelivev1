module.exports = (req, res) => {
  res.status(200).json({ ok: true });
};
module.exports.config = { runtime: "nodejs20.x" };
