"use strict";
const fs = require("node:fs");
function sample(driver, servers) {
  const processes = [];
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync("/proc/" + name + "/stat", "utf8"),
        tail = stat.slice(stat.lastIndexOf(")") + 2).split(" "),
        cmd = fs
          .readFileSync("/proc/" + name + "/cmdline", "utf8")
          .replaceAll("\0", " ");
      let group =
        Number(name) === driver
          ? "driver"
          : servers.some((s) => s.child.pid === Number(name))
            ? "backend"
            : /chromium/.test(cmd)
              ? /--type=renderer/.test(cmd)
                ? "application-renderer"
                : "browser-driver"
              : null;
      if (!group) continue;
      const io = Object.fromEntries(
        fs
          .readFileSync("/proc/" + name + "/io", "utf8")
          .trim()
          .split("\n")
          .map((l) => l.split(":").map((x) => x.trim())),
      );
      processes.push({
        pid: Number(name),
        parent: Number(tail[1]),
        group,
        cpuTicks: Number(tail[11]) + Number(tail[12]),
        rssBytes: Number(tail[21]) * 4096,
        readBytes: Number(io.read_bytes),
        writeBytes: Number(io.write_bytes),
      });
    } catch {}
  }
  let memoryCurrent = null,
    cpuStat = null;
  try {
    memoryCurrent = Number(
      fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8"),
    );
    cpuStat = fs.readFileSync("/sys/fs/cgroup/cpu.stat", "utf8");
  } catch {}
  return { at: Date.now(), processes, memoryCurrent, cpuStat };
}
module.exports = { sample };
