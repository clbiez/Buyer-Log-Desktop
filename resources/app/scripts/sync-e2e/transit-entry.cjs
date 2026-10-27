"use strict";
// Reuse the explicit source-cache seeding hook from BL019's supplied fixture.
process.env.BL_TEST_SEED = "1";
require("../../server/server.js");
global.__blSeedAsas(
  [
    {
      ocode: 9900001,
      model: "SYNTHETIC-TRANSIT",
      ccode: "01",
      colour: "BLUE",
      season: "W26",
      buyer: "Synthetic transit",
      buyerGrup: "DEMO",
      mag: "DEMO",
      mmyg: "DEMO",
      buyingGroup: "DEMO",
      manufacturer: "Demo Supplier",
      license: "DEMO",
      licensor: "DTR",
      countryRaw: "CHINA",
      qty: 100,
      kalan: 100,
      fob: 4,
      opd: new Date(2026, 0, 1),
      ex: new Date(2026, 10, 1),
      retail: new Date(2026, 11, 10),
      mb: new Date(2026, 11, 15),
    },
  ],
  "moderator",
  ["cp", "orders"],
);
