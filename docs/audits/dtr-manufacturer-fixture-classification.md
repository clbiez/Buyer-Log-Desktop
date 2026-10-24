# DTR manufacturer regression fixtures

Base: `8f38e202d4dce8362e227bf9cd7fab86cfbcf051` (merged #702).

The exact unchanged main reproduced four failures across `override-line-keys-v419.test.js` and `revision-v473.test.js`: 13 passed, 4 failed. They had implicitly assumed a licensed manufacturer was Non-DTR. The new main contract classifies manufacturers as DTR unless they are explicitly listed as Non-DTR; a factory's display name does not establish its classification.

The fixtures now explicitly classify `X` and `NON DTR FACTORY` for the scenarios that exercise editable sub-manufacturers. All existing line-key, legacy fallback, per-row override and DTR-default expectations remain. Two additional assertions verify that the intended Non-DTR branches are actually exercised. No production source, expected financial amount or runtime policy changes.

After the fixture correction, those tests plus the new DTR manufacturer suite pass 21/21 with zero skips. Tests used isolated synthetic data roots on Windows Node24.18.0. Broader combined integration evidence is recorded separately; this branch is not independently certified full-green. No merge or release was performed.
