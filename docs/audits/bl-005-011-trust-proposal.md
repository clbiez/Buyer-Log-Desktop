# BL-005 / BL-011 — patch trust and release decision

> **Historical proposal, superseded on 2026-10-24.** The sections below describe
> main `5a5c3bc` before implementation; their pending approvals and present-tense
> workflow descriptions are not current operating instructions. The user later
> authorized development and merge, and separately approved adding the manual
> publisher workflow only. No publication or workflow dispatch was authorized.
>
> **Tarihsel öneri:** Aşağıdaki bekleyen kararlar ve eski yayın davranışı güncel
> durumu anlatmaz. Uygulama ve merge yetkilendirildi; ek yayın onayı yalnız
> workflow kodunun eklenmesini kapsar. Yayın başlatılmadı.

## Implemented outcome and remaining deployment gates

[PR #688](https://github.com/clbiez/Buyer-Log-Desktop/pull/688) merged at
`991135c670f9fe8821354739b3636e615a9de2e0`. The installed Electron bootstrap now
verifies a separate signed-v3 manifest with pinned publisher keys before the
native JSON/ZIP picker can stage a complete immutable core. This replaces the
proposed need to trust a downloaded PowerShell verifier. It does not prevent an
operator from independently executing an older external script; legacy channel
retirement and deployment remain separate decisions.

The six-member recovery set includes DB, BAK, WAL, WAL.BAK, pointer and state.
Trial writes and shared publication wait for exact durable health confirmation;
rollback preserves the highest accepted patch sequence. The transitional
publisher is frozen and the new publisher is manual-only with explicit source
SHA, full tests before signing, immutable assets and no Actions ZIP storage.

The final contract is [SIGNED_MANUAL_PATCH.md](../SIGNED_MANUAL_PATCH.md).
The [Windows acceptance record](bl-003-005-011-windows-acceptance-20261024.json)
records 7,550 passed / 0 failed / 6 skipped tests on code commit `2c6cdcb`, plus
actual isolated Electron 44.3.0 preparation, authority rejection, delayed-health
write fencing, failed-trial rollback and replay rejection. Fixture signing keys
were ephemeral; production keys were not accessed. Corporate SMB, Excel/Outlook,
hardware failure and live secret-backed publication are not certified by that
synthetic acceptance. Full signed-bootstrap deployment must precede v3 patches;
neither TEST, STABLE nor manual patch publication has run.

## Original proposal (historical)

Historical status: Investigating; concrete compatibility proposal awaiting product/security
approval. Runtime, installer and publication policy are unchanged. This document
does not close either work package. Baseline: main 5a5c3bcafd4de929019b3bba522ef5771670b171.

## Verified current trust boundary

The official updater's `electron/update/signature.js` enforces Ed25519 when
trusted public keys are bundled in the running installation. The manual channel
is explicitly unofficial/unsigned. `scripts/mini_patch_builder.py` includes
SHA-256 identity for runtime payloads in schema2 metadata; the PowerShell
installer validates those hashes, base version, compatible prior file identity
and protected paths. Those safeguards remain valuable, but a coherently changed
payload and manifest can satisfy their own hashes without a publisher signature.

`scripts/BuyerLog-OtoPatch.ps1` validates downloaded ZIP size/hash against a
schema1 index from the same release source. Its local `Apply-MiniPatch.ps1` is
executed using PowerShell ExecutionPolicy Bypass. Offline command wrappers also
execute the installer shipped inside that ZIP. A signature verifier supplied
only by the same replaceable ZIP cannot establish a new trust root. No evidence
of an actual compromised release, exposed signing secret or official updater
accepting an unsigned release was found or asserted.

The current auto publisher triggers on filtered main pushes, merged main PRs,
a 15-minute schedule and workflow_dispatch. It resolves and checks out a pinned
main SHA rather than an untrusted PR head; the build job does not receive the
publication secret. It runs mini_patch_ci.py on Windows for compatibility,
application and rollback of files, but not the application regression suite.
The separate publish job requires build success and verifies ZIP hash/size and
source SHA. Its later index update checks main has not advanced. These existing
controls should be retained.

The schedule compares source commit identity, so a docs-only main commit can
request a cumulative runtime patch even though push path filters exclude docs.
This is a confirmed policy gap, not proof that every docs commit changes runtime.
ZIP artifact transfer is explicit; whether the installation/TEST zero-artifact
policy includes this separate unofficial channel needs an explicit decision.

## Proposed compatible implementation

Recommended decision: retain the manual/offline workflow temporarily, introduce
an authenticated v3 channel through a signed bootstrap upgrade, and require
explicit publication approval plus appropriate application checks. Alternative:
retire executable mini-patches after the same trusted migration, using signed
official releases exclusively. Do not abruptly disable existing deployed tools.

1. Ship a trusted full installer/bootstrap update, with pinned publisher public
   keys and the verifier outside replaceable patch content. The installed trust
   root must cover the launcher and patch-manager entry point. Reuse official
   publisher authority; no second ad-hoc provider or new key provisioned here.
   Actual Windows PowerShell/.NET availability and offline Ed25519 verification
   must be tested before selecting the exact verifier host. Do not require a
   system Node/Python runtime on client machines.
2. Define domain-separated `buyer-log-manual-patch/v3` canonical signed bytes:
   product/schema, monotonically increasing patch sequence, base version/source
   commit, target source commit, minimum trusted bootstrap version, ZIP size/hash,
   ordered relative paths/kinds, accepted before hashes and resulting after
   hashes. Bind the entire manifest and installer/manager identities. Reject
   duplicate/ambiguous paths, unsigned/untrusted metadata and unverified script
   execution before staging or touching live files. Do not reuse official signed
   payload serialization without a schema-specific contract.
3. Verify with installed pinned keys before downloads/extraction, then reverify
   ZIP/manifest/each staged file. Retain protected paths, base compatibility,
   all-file validation, application-closed checks, backups and recovery. Keep a
   durable highest accepted sequence per base; reject replay/downgrade by
   default. An explicit verified local rollback must not lower the network
   acceptance watermark. Support key overlap/rotation through a previously
   trusted signed bootstrap; package-supplied keys cannot authorize themselves.
4. Publish a separate authenticated feed so older tools cannot mistake v3 for
   their existing schema. Make legacy feed retirement a deliberate staged
   decision based on installed-client inventory. No usage telemetry or hidden
   background process is added. Until migration, label legacy channel as having
   hash consistency checks without publisher authenticity.
5. Add a pinned-source application regression gate before executable publication
   as well as existing Windows installer checks. Derive eligible runtime changes
   from the exact pinned commits, excluding docs/release-note-only changes; do
   not rely on push filters alone. Failure/skip of a required check must block
   publication. Keep untrusted PR code away from publication/signing secrets.
   Decide whether to replace automatic publication with a protected manual
   approval and whether mini-patch ZIP transfer must leave Actions artifacts.

The same full-bootstrap migration should carry BL-003's persistent-launcher
rollback recovery protocol. App-core-only patches cannot safely update the old
bootstrap or provide that protocol retroactively. Do not advance
minimumUpdaterVersion or publish any package before the Windows migration and
rollback acceptance matrix is complete.

## Evidence and acceptance gates

`node docs/audits/bl-005-011-trust-probe.cjs` runs entirely in memory with harmless
synthetic strings and ephemeral keys. It demonstrates that a coherently changed
payload/hash passes a diagnostic model of current hash checks, whereas the
actual official verifier rejects unsigned or coherently tampered metadata under
a pinned synthetic key. The model does not execute PowerShell and is not a
confirmed Windows installer exploit. Results accompany this file. No signing
secret, release feed or real installation is accessed.

Before implementation is accepted: actual Windows negative installer/manager
tampering, offline verification, authentic prior-base upgrade, all-file partial
failure recovery, replay/downgrade, key overlap/rotation, changed manager script,
interrupted migration and BL-003 trial-edit/quiescence tests must pass. Existing
full app regressions must have a truthful baseline. Required publication tests
must prove that failing app checks and docs-only commits cannot publish, and
untrusted PR heads never run with secrets. These gates are not executed by this
proposal. No visual evidence is fabricated for a workflow that has not changed.

## Approval required before policy implementation

Approve the recommended staged signed v3 bridge or choose signed-release-only
retirement; confirm automatic versus manually approved mini-patch publication
and the scope of the ZIP artifact rule. These choices affect deployed clients
and an established release workflow, so the original execution directive
requires approval. Ordinary isolated engineering/tests on other work packages
can continue while these decisions remain pending. No merge/release is requested.
