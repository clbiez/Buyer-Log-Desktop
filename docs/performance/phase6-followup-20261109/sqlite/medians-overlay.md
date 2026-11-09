
Median wall time (ms)

| Events | Engine | Open + first queries | First full hydrate | Open through full records ready | Mixed trace | Repeat full records | Compaction |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 1474.0 | 2.511 | 1476.5 | 1512.0 | 2.658 | 2637.7 |
| 10,000 | sqlite | 3.257 | 94.0 | 97.8 | 197.2 | 55.8 | 232.2 |
| 200,000 | local | 5829.8 | 25.0 | 5852.1 | 6015.4 | 31.0 | 39666.5 |
| 200,000 | sqlite | 5.552 | 1557.3 | 1563.9 | 232.9 | 1198.5 | 6188.2 |

Median of per-run p95 latency (ms; batch = 20 events)

| Events | Engine | Point | Filter | Pending 100 | Single write | Batch 20 | Max write (median) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 1.423 | 5.570 | 2.662 | 33.7 | 35.6 | 90.2 |
| 10,000 | sqlite | 0.102 | 0.934 | 1.068 | 2.647 | 5.304 | 9.192 |
| 200,000 | local | 1.383 | 103.0 | 16.4 | 30.9 | 26.1 | 87.3 |
| 200,000 | sqlite | 0.132 | 1.109 | 0.733 | 2.547 | 7.156 | 20.7 |

Median process memory (MiB; RSS includes native memory)

| Events | Engine | Open RSS | Steady RSS | Steady heap | Post-compact RSS | Peak RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 211.8 | 195.2 | 21.8 | 234.6 | 322.4 |
| 10,000 | sqlite | 133.7 | 142.7 | 11.5 | 149.6 | 158.8 |
| 200,000 | local | 940.4 | 588.9 | 378.4 | 772.9 | 2261.1 |
| 200,000 | sqlite | 539.6 | 540.6 | 167.9 | 696.1 | 705.7 |

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
| 10,000 | local | 3735.3 | 2188.1 | 2659.5 | 84.4 |
| 10,000 | sqlite | 548.1 | 243.5 | 281.0 | 30.4 |
| 200,000 | local | 49405.1 | 17731.1 | 40019.7 | 604.9 |
| 200,000 | sqlite | 8941.2 | 5149.9 | 7010.2 | 530.8 |

Quiescent backup lower bound (not production protocol parity)

| Events | Engine | Backup ms | Copy restore ms | Restore through verification ms | Independent backup MiB | Post-compact disk + independent backup MiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 94.1 | 74.7 | 357.3 | 25.2 | 50.4 |
| 10,000 | sqlite | 60.3 | 96.4 | 277.1 | 14.4 | 28.8 |
| 200,000 | local | 1976.0 | 2439.2 | 9767.0 | 445.9 | 891.8 |
| 200,000 | sqlite | 1638.3 | 2546.3 | 7591.6 | 298.9 | 598.4 |
