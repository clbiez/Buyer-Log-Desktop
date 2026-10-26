"use strict";
// Invoke the unchanged standard runner for only files not reached by its stopped run.
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  repo = path.resolve(__dirname, "../../.."),
  app = path.join(repo, "resources/app"),
  testRoot = path.join(app, "tests"),
  log = fs.readFileSync(path.join(__dirname, "full-suite.log"), "utf8");
const collect = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? collect(path.join(dir, e.name))
        : e.isFile() && e.name.endsWith(".test.js")
          ? [path.join(dir, e.name)]
          : [],
    );
const all = collect(testRoot).sort((a, b) => a.localeCompare(b)),
  isolated = all.filter(
    (f) => path.basename(f) === "sync-simulation-v20261009.test.js",
  ),
  parallel = all.filter((f) => !isolated.includes(f));
const completed = [...log.matchAll(/Batch \d+\/\d+ \((\d+) dosya\)/g)].reduce(
    (a, m) => a + Number(m[1]),
    0,
  ),
  remaining = [...parallel.slice(completed), ...isolated],
  rel = (f) => path.relative(app, f).split(path.sep).join("/");
if (completed !== 600)
  throw Error("Unexpected completed batch boundary: " + completed);
const manifest = {
  source: require("node:child_process")
    .execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo })
    .toString()
    .trim(),
  totalFiles: all.length,
  priorFiles: parallel.slice(0, completed).map(rel),
  remainingFiles: remaining.map(rel),
  runner: "tests/run-tests.js",
  supportedConcurrency: 2,
};
fs.writeFileSync(
  path.join(__dirname, "full-suite-resume-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "RESUME",
  remaining.length,
  "files through unchanged standard runner; prior",
  completed,
);
const result = spawnSync(
  process.execPath,
  ["tests/run-tests.js", ...remaining.map(rel)],
  {
    cwd: app,
    env: { ...process.env, BUYER_LOG_TEST_CONCURRENCY: "2" },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status || 0;
