// Forward /api/pro-pick to the Express app
const app = require("../overedge-api/server");
module.exports = (req, res) => app(req, res);
module.exports.config = { runtime: "nodejs20.x" };
