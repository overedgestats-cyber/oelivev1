// overedge-api/lib/competitions.js

// --- PRO/INTL competitions you want EXCLUDED from Free Picks
const PRO_COMP_IDS = new Set([
  // England
  "EPL","ENG1","ENG-1","Premier League",
  "CHAMP","ENG2","Championship",
  // Germany
  "BUN1","GER1","Bundesliga",
  "BUN2","GER2","2. Bundesliga",
  // Spain
  "SPA1","LL1","LaLiga","La Liga",
  "SPA2","LL2","LaLiga2","La Liga 2","Segunda",
  // Italy
  "ITA1","SERIA","Serie A",
  "ITA2","SERIB","Serie B",
  // France
  "FRA1","L1","Ligue 1",
  "FRA2","L2","Ligue 2",
  // International tournaments
  "FIFA","UEFA","UCL","UEL","UECL","AFCON","ASIA","EURO",
]);

// --- All EU first/second divisions you want in Free Picks (but not in PRO above)
const EU_T1_T2 = [
  // Austria
  "AUT1","AUT2",
  // Belgium
  "BEL1","BEL2",
  // Netherlands
  "NED1","NED2","ERE","Eerste Divisie",
  // Portugal
  "POR1","POR2",
  // Scotland
  "SCO1","SCO2",
  // Switzerland
  "SUI1","SUI2",
  // Denmark
  "DEN1","DEN2",
  // Norway
  "NOR1","NOR2",
  // Sweden
  "SWE1","SWE2",
  // Poland
  "POL1","POL2",
  // Czech
  "CZE1","CZE2",
  // Austria, Hungary, Greece, Turkey, Romania, Serbia, Croatia, etc.
  "HUN1","HUN2","GRE1","GRE2","TUR1","TUR2","ROU1","ROU2",
  "SRB1","SRB2","CRO1","CRO2","SVK1","SVK2","SVN1","SVN2",
  "BUL1","BUL2","UKR1","UKR2","RUS1","RUS2",
  // Spain/Italy/France/England/Germany *lower-tier alternates if any* can be added
];

// Candidate set for Free Picks = EU T1/T2 MINUS PRO competitions
const FREE_PICKS_COMP_IDS = new Set(
  EU_T1_T2.filter(c => !PRO_COMP_IDS.has(c))
);

module.exports = { PRO_COMP_IDS, FREE_PICKS_COMP_IDS };
