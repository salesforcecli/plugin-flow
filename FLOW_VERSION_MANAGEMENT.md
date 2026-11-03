# Flow version management

Run these commands from the plugin-flow checkout after installing dependencies and compiling the plugin. Build and link the Flow Node library using the repository development setup first. The commands use the existing Salesforce CLI org authorization and accept any authenticated org alias and Flow API name.

## Backend compatibility

Version management requires API 67.0 or later and these authenticated server operations:

| Command path               | Required operation                                             |
| -------------------------- | -------------------------------------------------------------- |
| List and retention catalog | `POST /connect/interaction/flow-versions/list`                 |
| Normal deletion preview    | `POST /connect/interaction/flow-versions/deletion-assessment`  |
| Normal deletion            | `DELETE /tooling/sobjects/Flow/{versionId}`                    |
| Force preview              | `POST /connect/interaction/flow-versions/force-delete/preview` |
| Force execution            | `POST /connect/interaction/flow-versions/force-delete`         |

The API version prefix is selected from the authenticated Connection. Availability of the CLI package does not establish that these server operations are installed in an org. Authentication, request failures and malformed responses are reported as errors; the client does not substitute inferred eligibility or counts.

The production integration delegates inventory, eligibility and retention selection to shared B services, and force deletion to the D API. Those service bindings are still being finalized. The currently supported wire contracts and interim retention behavior below remain explicit until that integration is available.

## List versions

Choose exactly one scope: `--flow <API name>` or `--all`. Use a qualified API name for a namespaced Flow.

```bash
node bin/run.js flow version list --target-org my-org --api-version 67.0 --flow Account_Onboarding
node bin/run.js flow version list --target-org my-org --api-version 67.0 --all --json
node bin/run.js flow version list --target-org my-org --all --status Obsolete --older-than 90d --min-percent 80 --deletable
```

The server supplies version metadata, actual org version limit, counts and normal deletion eligibility. The client follows pagination and retains completeness information. Null values remain unavailable; they are never replaced by zero. `PASS` displays Yes, `BLOCKED` displays No with its reason, and `ERROR` means the row was not fully assessed.

The current list contract derives age from Created Date. Production B1 specifies Last Modified Date. The backend and client must adopt the same age basis when the shared B1 contract is bound; the client does not silently reinterpret server age values.

## Preview and delete explicit versions

Version lists and inclusive ranges are supported, with up to 200 distinct numbers. Selection is resolved to exact definition/version identities; Active or latest versions are never substituted for missing numbers.

```bash
node bin/run.js flow version delete \
  --target-org my-org \
  --api-version 67.0 \
  --flow Account_Onboarding \
  --versions 1,2,4-6 \
  --dry-run
```

The same command works on one line. Existing bare value syntax is also accepted; Boolean options retain their dashes:

```bash
node bin/run.js flow version delete target-org my-org flow Account_Onboarding versions 1,2,4-6 --dry-run
```

Omit `--dry-run` to display the assessed plan and request confirmation. The default is No; timeout or cancellation closes the prompt without deleting. Explicit `--yes` is required for normal noninteractive or JSON execution.

Every exact target is rechecked after confirmation. A blocked or known-failed version does not prevent eligible siblings from being processed. Normal deletion does not abandon interviews or remove references. A lost or inconclusive mutation response remains `UNKNOWN` and stops subsequent mutations; it is not automatically retried.

The client currently preserves the last remaining version with a separately labeled client policy. This is not a claimed server restriction. The product decision about deleting the empty definition remains open; managed-package restrictions remain server-owned.

## Retention cleanup

Preview is the default:

```bash
node bin/run.js flow version prune --target-org my-org --flow Account_Onboarding --keep-latest 5 --older-than 90d
node bin/run.js flow version prune --target-org my-org --all --keep-latest 5 --older-than 90d --dry-run --json
```

`--execute` requests interactive confirmation. `--yes` is the explicit noninteractive execution option. Both are mutually exclusive with `--dry-run`. Force deletion is never used by retention cleanup.

The current client reads the complete unfiltered catalog, keeps Active and the latest N, and adds an interim rollback safeguard based on the newest Obsolete `statusChangeDate`. It keeps all newest ties, or all Obsolete versions when their timestamps are all null. Packaging can change that timestamp, so it is not proof of previous activation. Missing required metadata or an incomplete catalog prevents selection.

Only remaining inactive versions old enough according to server `ageDays` and marked `PASS`/deletable become candidates. Fresh identity, eligibility and retention checks precede each deletion; confirmation cannot add or substitute targets.

Production B1 protects Active and the latest N and uses Last Modified Date. Shared candidate selection will replace the interim client rule after its request/response contract is agreed. The current command does not claim B1 parity.

## Force-delete one version

Force deletion is manual, requires interactive terminals and accepts exactly one positive version number. It uses dedicated preview/execute operations; no force flag is added to Tooling DELETE.

```bash
node bin/run.js flow version delete --target-org my-org --flow Account_Onboarding --versions 2 --force --dry-run
node bin/run.js flow version delete --target-org my-org --flow Account_Onboarding --versions 2 --force
```

The CLI displays actual server impact and eligibility, then requires the exact Flow API name and version number. `--yes` cannot approve force execution. Tokens and typed answers are omitted from reports, console output and JSON. Force execution with JSON still requires interactive input/output and sends human prompts to stderr.

Force execution requires a backend that enforces the opt-in Force Delete Flow Versions permission, org-level disable, impact-bound token authorization, interview/registration cleanup, orchestration handling and audit. These are server responsibilities. Unsupported impact data remains unavailable, and an ineligible preview never executes. Backend production readiness must be established independently of client tests.

## Reports and scripting

JSON schemas are checked in under `schemas/flow-version-{list,delete,prune,force-delete}.json`. Normal deletion uses report contract 2; list, retention and force reports use contract 1. Reports preserve exact identities, backend reasons and confirmed versus uncertain mutation outcomes.

| Result                                                  | Exit |
| ------------------------------------------------------- | ---- |
| Completed preview, cancellation, or successful deletion | 0    |
| Deletion blocked without another failure                | 1    |
| Failed, unassessed, uncertain, or unattempted execution | 2    |

List exits 1 for truncation or an assessment error, and 0 for a complete result that may include blocked rows. Invalid input, authentication and whole-request failures return command errors. The product wording about failed dry-run requests remains open; a completed preview retains its per-version blockers/errors and exits 0.

Client tests use isolated providers, native Connection mocks and terminal fixtures. They do not establish live server authorization, audit, abandonment or rollback behavior.
