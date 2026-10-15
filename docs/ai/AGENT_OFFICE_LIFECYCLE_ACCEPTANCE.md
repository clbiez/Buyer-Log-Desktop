# Agent Office task lifecycle, restart safety and cross-module handoff

Office tasks (`server/lib/agent-office-tasks.js`) move through these states:

| Situation | Path |
|---|---|
| Normal run | `queued` → preview → `waiting_approval` (writes) → `running` |
| After running | `completed` / `partial` / `waiting_operation` / `waiting_output` |
| After undo | `rolled_back` |
| Failures and refusals | `failed` / `interrupted` / `rejected` / `cancelled` |

Read steps run without approval; every effect step waits for an approval bound to its exact preview. Restart reconciliation in the existing queue:
- A Runtime-completed effect adopts its verified receipt.
- An effect whose executor died is `interrupted`; a read is re-queued.
- `waiting_operation` keeps polling.
- A step that has not been approved stays `waiting_approval`.
- A terminal task returns unchanged.

This packet adds four things.

**Durable native completion.** `agent-native-route-runs` runs these route handlers in-process for Office:
- technical sheets,
- model images,
- sample requests.

When a run finishes, a reduced result (success, code and the capability's own summary) is written to an owner-isolated file. Retention is 7 days. After a restart:
- A job that finished is completed from that file, with no repeated effect.
- A job that died with the process has no file, so its receipt fails closed (`OFFICE_NATIVE_RECEIPT_INVALID`) and it feeds no later step.

**Cross-module handoff.**
- Each step may name its own agent.
- A binding path can project a list. For example, `data.entries[].plmId` turns a CP agent's PLM BOM read into the Collection agent's technical sheet download. A projected list of plain values is de-duplicated.
- Forbidden keys (`__proto__`, `constructor`, `prototype`) never resolve.
- The AI planner guide describes the projection.

**Live dialog.** An open task dialog follows a `queued` / `running` / `waiting_operation` job every 5 s and re-renders when a step changes. It never replaces typed correction text.

**Tests.** `tests/agent-office-lifecycle-e2e.test.js` has 5 cases. It uses the real Office service, Runtime, stores and capabilities, with two agents in different modules:
- the cross-module handoff;
- approval binding (a wrong approval starts nothing);
- the native wait and its partial result;
- a restart after a finished job (completed from the durable result, effect ran once);
- a restart while the job was still running (fails closed, stores nothing);
- `waiting_approval` across a restart;
- undo after a restart;
- refusal is terminal;
- the live dialog contract.

The existing lifecycle suites also pass: native waiting, partial undo, capability tasks and process sync.

**Real Chromium on an isolated demo server, TR and EN:**
- A CP agent and a Collection agent ran a two-step handoff task, and only the PLM ID the first agent actually found was bound into the second step.
- The server was restarted while the task waited for approval. It still waited after the restart and was approved in the real dialog.
- The dialog followed the native wait to "Kısmen tamamlandı / Partially completed", with the PLM failure code. There is no corporate PLM session here.
- No page errors.
