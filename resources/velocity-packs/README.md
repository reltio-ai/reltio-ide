# Bundled Velocity Packs

Industry **Velocity Pack** reference `BusinessConfig.json` files ship here and in the **`.vsix`**. The extension copies this tree to **`.reltio/reltio-agent/velocity-packs/`** in the opened workspace when **`velocityPacksBundleVersion`** in `resources/reltio-agent-assets.json` advances (see `design.md` D3b / D4b in OpenSpec `skills-and-enablement-packs-library`).

## Pack inventory

| Pack id | Purpose (short) | License / notes |
|---------|-----------------|-----------------|
| Account360 | Cross-industry account / party patterns | `Account360/README.md` (Apache 2.0) |
| Consumer360 | Consumer domain | `Consumer360/README.md` (Apache 2.0) |
| freetier-identity360-datavalidation | Identity360 freetier / validation variant | *(no README in bundle)* |
| Identity360 | Identity / CIAM-style extensions | *(no README in bundle)* |
| Insurance | Insurance vertical (`dp_ins.*` schema line) | *(no README in bundle)* |
| LSCustomer360 | Life sciences customer | `LSCustomer360/README.md` (Apache 2.0) |
| LSProduct360 | Life sciences product | `LSProduct360/README.md` (Apache 2.0) |
| Product360 | Generic product / item | `Product360/README.md` (Apache 2.0) |

**Redistribution:** Packs that include `README.md` with **Apache License 2.0** text are marked above. Only bundle packs your organization has approved for distribution inside the VSIX; see `design.md` D6.

## Maintainer workflow

1. Add or replace folders under `resources/velocity-packs/<packId>/`.
2. Update **`manifest.json`**: paths, `schemaVersion`, `bytes`, `sizeTier`, `vertical`, `referenceConfigurationURI`, `readmePath`, `packKind`.
3. Bump **`velocityPacksBundleVersion`** in `resources/reltio-agent-assets.json`.
4. Optional: run `node scripts/velocity-packs-validate-manifest.cjs` to validate paths and totals.
