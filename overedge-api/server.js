const express = require("express");
const app = express();
app.use(express.json());
app.get("/api/health", (_req, res) => res.status(200).json({ ok: true, service: "overedge-api" }));
module.exports = app;
