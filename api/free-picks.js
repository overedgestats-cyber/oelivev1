// api/free-picks.js
const app = require("../overedge-api/server");

module.exports = async (req, res) => {
  try {
    return app(req, res);
  } catch (err) {
    console.error("free-picks handler error:", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      error: "free-picks failed",
      message: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    }));
  }
};

module.exports.config = { runtime: "nodejs20.x" };
