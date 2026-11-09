Base Main: 62f2153d258374e98f5582994042119c6b6cc495.
Scope: shared module trivia hold geometry and CSS; no data processing/native changes.
Scenario: isolated Buyer Log CP, Orders and Collection sections; loading then ready;
normal 1787x813, short 960x480, narrow 640x480, 320x568; TR/EN, light/dark, all scales.
Before implementation budgets: Continue fully visible and hit-testable without scrolling;
all fact text reachable by scrolling only its content; no horizontal overflow;
ready-to-Continue response <=200ms (reduced-motion), no new >50ms main-thread task;
no duplicate request/timer/listener, hold/panel ownership returns to zero after 5 cycles.
Compare at least 3 alternating baseline/candidate pairs on same Chromium/server/fixture;
record render TaskDuration and LayoutDuration, raw samples; investigate median increases
using A/A runs, never assume a fixed percentage tolerance.
No native/preload/server/data calculation changes; native performance gate N/A by scope.
