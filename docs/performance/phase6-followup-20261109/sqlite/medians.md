> Supplementary **tmpfs** series (run-2). These are RAM-backed filesystem results, not disk/fsync acceptance. The final local overlay series is in medians-overlay.md. Do not pool the series.


Median wall time (ms)

| Events | Engine | Open + first queries | First full hydrate | Open through full records ready | Mixed trace | Repeat full records | Compaction |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 711.2 | 2.013 | 716.0 | 1017.2 | 2.692 | 2020.9 |
| 10,000 | sqlite | 1.636 | 115.8 | 117.5 | 115.2 | 62.5 | 103.3 |
| 200,000 | local | 7810.8 | 31.0 | 7866.3 | 6443.4 | 64.3 | 62276.4 |
| 200,000 | sqlite | 4.001 | 2105.8 | 2109.8 | 164.5 | 1657.8 | 4608.4 |

Median of per-run p95 latency (ms; batch = 20 events)

| Events | Engine | Point | Filter | Pending 100 | Single write | Batch 20 | Max write (median) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 1.219 | 4.780 | 4.329 | 19.3 | 19.4 | 37.7 |
| 10,000 | sqlite | 0.091 | 0.986 | 1.032 | 0.449 | 2.630 | 5.249 |
| 200,000 | local | 1.223 | 113.6 | 26.9 | 17.4 | 13.9 | 36.9 |
| 200,000 | sqlite | 0.196 | 1.211 | 1.000 | 0.736 | 3.978 | 7.093 |

Median process memory (MiB; RSS includes native memory)

| Events | Engine | Open RSS | Steady RSS | Steady heap | Post-compact RSS | Peak RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 215.2 | 195.9 | 21.8 | 236.1 | 323.9 |
| 10,000 | sqlite | 132.9 | 141.9 | 11.5 | 148.7 | 158.0 |
| 200,000 | local | 954.6 | 585.6 | 378.4 | 796.6 | 2177.9 |
| 200,000 | sqlite | 539.8 | 540.8 | 167.9 | 696.8 | 705.9 |

Median disk footprint (MiB; primary + WAL + all backups/recovery files)

| Events | Engine | Before compact | After compact | After close | Primary after compact |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 28.4 | 25.2 | 25.2 | 12.6 |
| 10,000 | sqlite | 23.7 | 14.4 | 14.4 | 14.4 |
| 200,000 | local | 804.8 | 445.9 | 445.9 | 222.9 |
| 200,000 | sqlite | 485.2 | 299.5 | 298.9 | 298.9 |

12 trials; 12 SIGKILL probes; validation=subset-passed.

CPU and maximum event-loop turn gap (includes I/O/GC)

| Events | Engine | User CPU ms | System CPU ms | Max turn gap ms | Sampled peak heap MiB |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 3072.7 | 1315.6 | 2042.0 | 84.4 |
| 10,000 | sqlite | 567.6 | 172.4 | 147.4 | 30.4 |
| 200,000 | local | 67694.1 | 25120.4 | 62977.8 | 649.8 |
| 200,000 | sqlite | 10081.8 | 5838.9 | 5485.5 | 530.8 |

Quiescent backup lower bound (not production protocol parity)

| Events | Engine | Backup ms | Copy restore ms | Restore through verification ms | Independent backup MiB | Post-compact disk + independent backup MiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 115.9 | 100.9 | 442.1 | 25.2 | 50.4 |
| 10,000 | sqlite | 85.3 | 107.4 | 288.7 | 14.4 | 28.8 |
| 200,000 | local | 3150.1 | 3928.0 | 16625.4 | 445.9 | 891.8 |
| 200,000 | sqlite | 2569.7 | 4207.7 | 9258.6 | 298.9 | 598.4 |
