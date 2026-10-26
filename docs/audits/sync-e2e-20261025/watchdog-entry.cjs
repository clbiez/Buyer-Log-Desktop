"use strict";
const path = require("node:path");
process.env.LOCALAPPDATA = path.join(
  path.dirname(process.env.BUYER_LOG_SERVER_DATA_ROOT),
  "localappdata",
);
require("../../../resources/app/server/watchdog.js");
