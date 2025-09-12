// api/[...all].js
const app = require('../overedge-api/server');
module.exports = (req, res) => app(req, res);
