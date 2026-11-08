# Portable native verifier preparation handoff

This branch only copies the existing frozen preparation packet. It does not regenerate or execute its candidate. All nine original files retain identical bytes, including historical absolute paths in README and MANIFEST.sha256. Use MANIFEST.portable.sha256 for verification from the transferred preparation directory.

Base Main: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`. No app/server production files changed. Candidate activation, native tests, committed-source integration, full regression and P1 review remain pending.

Preparation directory:
`scripts/prototypes/phase6c-native-verifier-validation-20261108/preparation/`

From the repository root, first verify the portable manifest with `sha256sum -c MANIFEST.portable.sha256` in that directory. Then, under the existing shared test/measurement lock, use these environment selectors with the actual native Node executable:

```sh
BL_NATIVE_VERIFIER_APP_ROOT="$PWD/resources/app" \
BL_NATIVE_VERIFIER_SOURCE="$PWD/scripts/prototypes/phase6c-native-verifier-validation-20261108/preparation/local-db.js" \
node --test scripts/prototypes/phase6c-native-verifier-validation-20261108/preparation/tests/local-db-private-durability.test.js
```

The remaining round-4 task instructions are unchanged. Source-pin mismatches must be inspected, not blindly updated. Existing production files remain read-only; adaptations stay in the prototype copy. No new test has been run for this transfer. No PR, merge, migration or TEST/STABLE release is included.
