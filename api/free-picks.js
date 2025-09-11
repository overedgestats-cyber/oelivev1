const minConf    = Number(req.query.minConf ?? FREEPICKS_MIN_CONF);
const minOdds    = Number(req.query.minOdds ?? FREEPICKS_MIN_ODDS);
const strictOnly = (req.query.strict ?? (FREEPICKS_STRICT_ONLY ? '1' : '0')) === '1';
