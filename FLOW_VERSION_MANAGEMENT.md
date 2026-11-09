# Flow version management

Run these commands from the plugin-flow checkout after installing dependencies and compiling the plugin. Build and link the Flow Node library using the repository development setup first. The commands use the existing Salesforce CLI org authorization and accept any authenticated org alias and Flow API name.

## Backend compatibility

Version management requires API 67.0 or later and these authenticated server operations:

| Command path               | Required operation                                             |
| -------------------------- | -------------------------------------------------------------- |
| List and retention catalog | `POST /connect/interaction/flow-versions/list`                 |
| Normal deletion preview    | `POST /connect/interaction/flow-versions/deletion-assessment`  |
| Normal deletion            | `POST /connect/interaction/flow-versions/delete`               |
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

Core supplies ageDays. Production B1 requires Last Modified Date; verify the backend age basis when the shared B1 contract is bound. The client does not silently reinterpret server age values.

## Preview and delete explicit versions

Repeat --versions for multiple values or ranges. Comma-separated values remain supported, with up to 200 distinct numbers. Selection is resolved to exact definition/version identities; Active or latest versions are never substituted for missing numbers.

```bash
node bin/run.js flow version delete \
  --target-org my-org \
  --api-version 67.0 \
  --flow Account_Onboarding \
  --versions 1 --versions 2 --versions 4-6 \
  --dry-run
```

The same command works on one line. Existing bare value syntax is also accepted; Boolean options retain their dashes:

```bash
node bin/run.js flow version delete target-org my-org flow Account_Onboarding versions 1,2,4-6 --dry-run
```

Without --dry-run, an interactive normal deletion displays its selection and asks for confirmation, defaulting to No with a 60-second deadline. In JSON mode or without interactive stdin and stdout, the command runs an assessment preview unless explicitly approved with -p / --no-prompt. The compatibility spellings --yes and -y remain accepted. Explicit --dry-run always takes precedence over approval and sends no mutation.

```bash
node bin/run.js flow version delete --target-org my-org --flow Account_Onboarding --versions 1 --versions 2-4 --json
node bin/run.js flow version delete --target-org my-org --flow Account_Onboarding --versions 1,2-4 --no-prompt --json
```

The first example previews; the second explicitly requests deletion. Boolean flags retain dashes in bare name/value syntax. A single --versions occurrence consumes one value; use repeated flags or commas, rather than space-separated values after one flag.

The client resolves exact version and definition IDs from the complete C1 list. A dry run sends the resolved selection in one assessment POST and never calls the mutation route. After confirmation, real deletion sends all resolved requested versions in one Core bulk-delete POST, including versions the list marked blocked or errored. The routes accept the CLI's full 200-version selection and return HTTP 201 with an ordered `results` array.

Core returns `DELETED`, `BLOCKED` or `ERROR` for each version. The CLI maps acknowledgements to customer-facing outcomes and preserves actual reasonCode and message values; the console shows the backend values. Public JSON does not include SDK coreResult or prepared plan objects. `DELETED` with `ALREADY_DELETED` is successful. A missing version number remains a local resolution error. A version that disappears after selection is still submitted by its original ID so Core can acknowledge that it is already gone.

Core owns mutation-time Active, packaging, interview, wait-condition, last-version and permission checks. The client does not add a last-version rule, drop blocked explicit targets or perform a Tooling DELETE. Preview and delete evidence arrays are empty. Normal deletion does not abandon interviews or remove references.

Retries and redirects are disabled for the mutation POST. Native session refresh remains available. A lost, malformed or inconclusive mutation response leaves the submitted versions `UNKNOWN`; no automatic retry follows. Reconcile the exact versions before another attempt.

## Retention cleanup

Preview is the default:

```bash
node bin/run.js flow version prune --target-org my-org --flow Account_Onboarding --keep-latest 5 --older-than 90d
node bin/run.js flow version prune --target-org my-org --all --keep-latest 5 --older-than 90d --dry-run --json
```

--execute requests interactive confirmation. -p / --no-prompt explicitly approves the prepared candidates without prompting; --yes / -y remain compatibility aliases. Without an execution request, prune always previews. --execute with JSON or noninteractive input/output also previews unless --no-prompt is supplied. Explicit --dry-run takes precedence over every execution option. Retention cleanup never force-deletes.

```bash
node bin/run.js flow version prune --target-org my-org --flow Account_Onboarding --execute
node bin/run.js flow version prune --target-org my-org --all --keep-latest 5 --older-than 90d --no-prompt --json
```

The current client reads the complete unfiltered catalog, keeps Active and the latest N, and adds an interim rollback safeguard based on the newest Obsolete `statusChangeDate`. It keeps all newest ties, or all Obsolete versions when their timestamps are all null. Packaging can change that timestamp, so it is not proof of previous activation. Missing required metadata or an incomplete catalog prevents selection.

Only remaining inactive versions old enough according to server `ageDays` and marked `PASS`/deletable become candidates. Fresh catalog identity, eligibility and retention checks precede each approved cleanup deletion, which uses the same Core delete client. Confirmation cannot add or substitute targets; cleanup never submits a blocked catalog row.

Production B1 protects Active and the latest N and uses Last Modified Date. Shared candidate selection will replace the interim client rule after its request/response contract is agreed. The current command does not claim B1 parity.

## Force-delete one version

Force deletion is manual, requires interactive terminals and accepts exactly one positive version number in one --versions occurrence. Repeated values, commas, ranges, --json and nonterminal use are rejected before inventory or preview requests, including with --dry-run. It uses the dedicated Connect preview and execution routes.

```bash
node bin/run.js flow version delete --target-org my-org --api-version 67.0 --flow Account_Onboarding --versions 2 --force --dry-run
node bin/run.js flow version delete --target-org my-org --api-version 67.0 --flow Account_Onboarding --versions 2 --force
```

Both POST requests send exactly `{"contractVersion":"1","versionId":"<exact version ID>"}` and expect HTTP 201 with one response object. Preview shows the server's reasons and interviews, plus evaluation completeness, truncation, lower bound, coverage and advisory status. A false `deletable` value alone does not prevent force execution: paused, failed and other supported saved interviews are impact this operation is intended to remove. The documented blocking reasons, Running or unsupported interview statuses, and an incomplete evaluation stop execution.

The CLI requires typing the exact Flow API name and version number into two empty prompts, with a shared two-minute deadline. --no-prompt and compatibility --yes cannot approve force execution and are ignored in force mode. --json is rejected even when a terminal exists. Typed answers are not sent to Core.

Execution posts the same version ID again only when the response is `IN_PROGRESS` with `hasMore: true`. It continues until a terminal outcome, prints reasons and errors, and stops on HTTP errors. Continuation is not a retry of a failed request. The command does not start a job or retarget another version. Interrupting continuation cannot undo work already completed by Core.

Preview does not require the `ForceDeleteFlowVersions` user permission. Execution requires it; Core returns `BLOCKED` with `INSUFFICIENT_ACCESS` when it is missing. The CLI does not grant that permission. Real force execution exits 0 only for DELETED. Blocked, failed, unknown or cancelled execution exits 1; invalid usage exits 2, and an actual confirmation deadline exits 69. A completed interactive read-only preview exits 0.

## Reports and scripting

The standard SfCommand JSON envelope supplies status, result and warnings. Normal deletion and prune return customer report contract 3 with the same top-level keys: mode, targetOrg, apiVersion, flow, dryRun, confirmed, outcome, results, summary, rule, impact, execution and warnings. The shared return type also represents force results, while the CLI rejects --force with --json. C1 list retains its existing grouped contract 1.

Each mutation result contains exact identities, action, nullable outcome, actual reasonCode/message, blockingReasons, nullable error and retention keepReason entries. Summary contains succeeded, blocked, failed, unknown, notAttempted, kept and wouldDelete. Prepared SDK plans and deletion-service objects are not exposed. Successful ALREADY_DELETED acknowledgements remain successful, with their actual reason code and message.

A preview has no acknowledged row outcomes and summary.succeeded is zero. Its blocked/failed counts describe assessment blockers and resolution/assessment errors; wouldDelete counts eligible preview actions. Unavailable blocker counts remain null. UNKNOWN and NOT_ATTEMPTED remain explicit execution outcomes, and protected retention versions count as kept rather than successful deletions.

Schemas are checked in as schemas/flow-version-list.json, schemas/flow-version-delete.json and schemas/flow-version-prune.json. Delete and prune schemas are generated from the public TypeScript report type; force shares the delete report type and has no separate command schema.

| Result                                                                                      | Exit |
| ------------------------------------------------------------------------------------------- | ---- |
| Successful deletion, no cleanup needed, or completed preview                                | 0    |
| Wholly blocked, failed, unconfirmed, or cancelled execution                                 | 1    |
| Invalid command usage                                                                       | 2    |
| Some deletions acknowledged successful and others definitively blocked/failed/not attempted | 68   |
| Actual confirmation deadline expired                                                        | 69   |

An unknown mutation outcome takes precedence over partial success and exits 1, requiring reconciliation. Completed previews exit 0 even with per-version blockers or assessment errors; authentication, transport and whole-request preview failures remain errors. The JSON envelope status mirrors the process exit code while retaining the public results for per-version execution outcomes.

A complete list exits 0, including blocked eligibility rows and empty selections. A truncated or partly assessed list with some successfully assessed rows exits 68 and retains those rows. An incomplete list with no assessed rows exits 1. Invalid scope or percentage input exits 2.

Client tests use isolated providers, native Connection mocks and real terminal fixtures. They do not establish live server authorization, audit, abandonment or rollback behavior. Backend B/D integration remains separate from this command-interface change.
