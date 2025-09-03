const app = require("../overedge-api/server");
module.exports = (req, res) => app(req, res);
module.exports.config = { runtime: "nodejs22.x" };
