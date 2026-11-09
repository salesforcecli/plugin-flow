# Salesforce Flow CLI Plugin

![npm (scoped)](https://img.shields.io/npm/v/@salesforce/plugin-flow)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/license/apache-2-0)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)

## Introduction

This oclif plugin provides Salesforce Flow test commands, dependency analysis, and version management. Flow tests use `@salesforce/apex-node`; version-management commands use `@salesforce/flow-node` from the [flows repository](https://github.com/forcedotcom/flows).

See [Flow version management](FLOW_VERSION_MANAGEMENT.md) and [Flow dependency analysis](FLOW_DEPENDENCIES.md) for command examples and backend compatibility.

### Building the Plugin

Clone the project and `cd` into it:

```
$ git clone git@github.com:salesforcecli/plugin-flow.git
$ cd plugin-flow
```

Ensure you have [Yarn](https://yarnpkg.com/) installed, then run:

```
$ yarn install
$ yarn build
```

<br />

### Linking the Plugin

Link the plugin from the `plugin-flow` package directory and then run your command:

```
$ sf plugins link .
$ sf flow run test -o myOrg@example.com
```

Alternatively, you can also run the command from the `plugin-flow` package directory without linking the plugin:

```
$ bin/dev.js flow run test -o myOrg@example.com
```

<br />

### Developing with Flow Node

Clone `forcedotcom/flows` beside this checkout to use your local library while developing:

```bash
cd ../flows
yarn install --frozen-lockfile
yarn build
yarn link --link-folder .yarn-links

cd ../plugin-flow
yarn install --frozen-lockfile
yarn link --link-folder ../flows/.yarn-links @salesforce/flow-node
yarn compile
node bin/run.js flow version list --help
```

Rebuild Flow Node after library changes. The local link uses the same public package entry point as the installed dependency. If Yarn is not on your PATH, use `corepack yarn`.

### Running the Test Suite

Test the test suite locally by building the project first and then running the tests.

```
$ yarn build
$ yarn test
```

<br />

# Commands

<!-- commands -->

- [`sf flow dependencies`](#sf-flow-dependencies)
- [`sf flow get test`](#sf-flow-get-test)
- [`sf flow run test`](#sf-flow-run-test)
- [`sf flow version delete`](#sf-flow-version-delete)
- [`sf flow version list`](#sf-flow-version-list)
- [`sf flow version prune`](#sf-flow-version-prune)

## `sf flow dependencies`

Inspect direct Flow dependencies and references in a target org.

```
USAGE
  $ sf flow dependencies -o <value> -f <value> [--json] [--flags-dir <value>] [--api-version <value>] [--namespace
    <value>] [--scan-flow <value>...] [--version-policy latest|active]

FLAGS
  -f, --flow-name=<value>        (required) API DeveloperName of the root Flow (without a namespace prefix).
  -o, --target-org=<value>       (required) Username or alias of the target org. Not required if the `target-org`
                                 configuration variable is already set.
      --api-version=<value>      Override the api version used for api requests made by this command
      --namespace=<value>        Namespace of the root and scanned Flows; omit for unmanaged Flows.
      --scan-flow=<value>...     Additional caller Flow DeveloperName to inspect; repeat for more Flows (20 total
                                 including the root).
      --version-policy=<option>  [default: latest] Select the latest or active version of each explicitly named Flow.
                                 <options: latest|active>

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Inspect direct Flow dependencies and references in a target org.

  Resolve the root Flow from --flow-name in --target-org, then read the selected version's metadata and extract its
  subflow references. Names, definition IDs, and version IDs are resolved from the org on every run; no fixture names or
  IDs are built into the command. Inspect additional candidate caller Flows when explicitly provided with --scan-flow.
  Also query MetadataComponentDependency for incoming and outgoing references to the root definition and selected
  version.

  --scan-flow is optional and repeatable. It defines which candidate caller Flows to inspect; it is not an automatic
  search for every caller in the org. Without it, the command still reads the root Flow and queries the dependency API,
  but incoming references can be incomplete.

  The default version policy is latest, including Draft versions. The active policy requires an active version for every
  selected Flow; it does not fall back silently. Flow names are DeveloperName values; use --namespace separately. The
  namespace applies to the root and explicitly selected scan Flows.

  This read-only command does not deploy, activate, execute, or delete metadata. It does not scan Apex source, resolve
  arbitrary runtime references, traverse dependencies recursively, generate a manifest, or claim a complete org-wide
  impact analysis. Empty dependency-API results do not mean no dependencies. Console output shows the root identity and
  incoming/outgoing relationships with their evidence. Use --json for structured results, including scan scope,
  dependency-API status, and coverage warnings.

EXAMPLES
  Inspect any Flow by its API DeveloperName in an authenticated org:

    $ sf flow dependencies --target-org my-org --flow-name MyFlowApiName

  Also inspect two candidate caller Flows without changing the command implementation:

    $ sf flow dependencies --target-org my-org --flow-name MyFlowApiName --scan-flow FirstCaller --scan-flow \
      SecondCaller

  Select active versions in a namespace and return structured evidence and coverage information:

    $ sf flow dependencies --target-org my-org --namespace acme --flow-name MyFlowApiName --version-policy active \
      --json
```

_See code: [src/commands/flow/dependencies.ts](https://github.com/salesforcecli/plugin-flow/blob/v2.0.2/src/commands/flow/dependencies.ts)_

## `sf flow get test`

Display test results for a specific asynchronous test run.

```
USAGE
  $ sf flow get test -o <value> -i <value> [--json] [--flags-dir <value>] [--api-version <value>]
    [--detailed-coverage -c] [-d <value>] [-r human|tap|junit|json] [--concise]

FLAGS
  -c, --code-coverage           Retrieve code coverage results.
  -d, --output-dir=<value>      Directory in which to store test result files.
  -i, --test-run-id=<value>     (required) ID of the test run.
  -o, --target-org=<value>      (required) Username or alias of the target org. Not required if the `target-org`
                                configuration variable is already set.
  -r, --result-format=<option>  [default: human] Format of the test results.
                                <options: human|tap|junit|json>
      --api-version=<value>     Override the api version used for api requests made by this command
      --concise                 Display only failed test results; works with human-readable output only.
      --detailed-coverage       Not available for flow tests.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Display test results for a specific asynchronous test run.

  Provide a flow test run ID to display test results for an enqueued or completed asynchronous test run. The test run ID
  is displayed after running the "sf flow run test" command.

  To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level
  summary of the test run and the code coverage values for flow tests in your org. If you specify human-readable result
  format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

EXAMPLES
  Display flow test results for your default org using a test run ID:

    $ sf flow get test --test-run-id <test run id>

  Similar to previous example, but output the result in JUnit format:

    $ sf flow get test --test-run-id <test run id> --result-format junit

  Also retrieve code coverage results and output in JSON format:

    $ sf flow get test --test-run-id <test run id> --code-coverage --json

  Specify a directory in which to save the test results from the org with the “me@my.org” username (rather than your
  default org):

    $ sf flow get test --test-run-id <test run id> --code-coverage --output-dir <path to outputdir> --target-org \
      me@my.org'
```

_See code: [src/commands/flow/get/test.ts](https://github.com/salesforcecli/plugin-flow/blob/v2.0.2/src/commands/flow/get/test.ts)_

## `sf flow run test`

Invoke flow tests in an org.

```
USAGE
  $ sf flow run test -o <value> [--json] [--flags-dir <value>] [--api-version <value>] [-r human|tap|junit|json]
    [--concise] [-d <value>] [-c] [-y] [-l RunLocalTests|RunAllTestsInOrg|RunSpecifiedTests] [-n <value>... | -s
    <value>... | -t <value>...]

FLAGS
  -c, --code-coverage           Retrieve code coverage results.
  -d, --output-dir=<value>      Directory in which to store test result files.
  -l, --test-level=<option>     Level of tests to run; default is RunLocalTests.
                                <options: RunLocalTests|RunAllTestsInOrg|RunSpecifiedTests>
  -n, --class-names=<value>...  Flow names that contain flow tests to run.
  -o, --target-org=<value>      (required) Username or alias of the target org. Not required if the `target-org`
                                configuration variable is already set.
  -r, --result-format=<option>  [default: human] Format of the test results.
                                <options: human|tap|junit|json>
  -s, --suite-names=<value>...  Not available for flow tests.
  -t, --tests=<value>...        Flow test names to run.
  -y, --synchronous             Run flow tests for one flow synchronously; if not specified, tests are run
                                asynchronously.
      --api-version=<value>     Override the api version used for api requests made by this command
      --concise                 Display only failed test results; works with human-readable output only.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Invoke flow tests in an org.

  Specify which tests to run by using the --class-names flag followed by the names of the flows you want to test. For
  example, if you save a flow with the name Flow1, then use: --class-names Flow1.

  To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level
  summary of the test run and the code coverage values for classes in your org. If you specify human-readable result
  format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

  By default, "flow run test" runs asynchronously and immediately returns a test run ID. If you use the -–synchronous
  flag, you can use the --wait flag to specify the number of minutes to wait; if the tests finish in that timeframe, the
  command displays the results. If the tests haven't finished by the end of the wait time, the command displays a test
  run ID. Use the "flow get test --test-run-id" command to get the results.

  To run both Flow and Apex tests together, run the "sf logic run test" CLI command, which has similar flags as this
  command, but expands the --tests flag to also include Apex tests.

  You must have the "View All Data" org system permission to use this command. The permission is disabled by default and
  can be enabled only by a system administrator.

EXAMPLES
  Run all local tests in your default org:

    $ sf flow run test --test-level RunLocalTests

  Run all the Flow1 and Flow2 flow tests in the org with alias “scratchOrg”:

    $ sf flow run test --target-org scratchOrg --class-names Flow1 --class-names Flow2

  Run specific Flow1 and Flow2 flow tests in your default org:

    $ sf flow run test --tests Flow1.Test1 --tests Flow2.Test2 --test-level RunSpecifiedTests

  Run all tests synchronously in your default org; the command waits to display the test results until all tests
  finish:

    $ sf flow run test –synchronous

  Run all local tests in the org with the username “me@my.org”; save the output to the specified directory:

    $ sf flow run test --test-level RunLocalTests --output-dir /Users/susan/temp/cliOutput --target-org me@my.org

FLAG DESCRIPTIONS
  -l, --test-level=RunLocalTests|RunAllTestsInOrg|RunSpecifiedTests  Level of tests to run; default is RunLocalTests.

    Here's what the levels mean:

    - RunLocalTests — All tests in your org are run, except the ones that originate from installed managed and unlocked
    packages.
    - RunAllTestsInOrg — All tests are run. The tests include all tests in your org, including tests of managed
    packages.
    - RunSpecifiedTests - Only the tests that you specify with the --tests flag are run.

  -n, --class-names=<value>...  Flow names that contain flow tests to run.

    Default is all flow tests. If you select --class-names, you can't specify --tests.

  -s, --suite-names=<value>...  Not available for flow tests.

    Not available for flow tests.

  -t, --tests=<value>...  Flow test names to run.

    Default is all flow tests. If you specify --tests, you can't specify --class-names.
```

_See code: [src/commands/flow/run/test.ts](https://github.com/salesforcecli/plugin-flow/blob/v2.0.2/src/commands/flow/run/test.ts)_

## `sf flow version delete`

Delete selected Flow versions normally, or force-delete one version with interactive confirmation.

```
USAGE
  $ sf flow version delete -o <value> -f <value> --versions <value>... [--json] [--flags-dir <value>] [--api-version
    <value>] [--namespace <value>] [--dry-run] [-p] [--force]

FLAGS
  -f, --flow=<value>         (required) API DeveloperName of the Flow, without its namespace prefix.
  -o, --target-org=<value>   (required) Username or alias of the target org. Not required if the `target-org`
                             configuration variable is already set.
  -p, --no-prompt            Authorize normal deletion without prompting; ignored by --force, which requires typed
                             confirmation.
      --api-version=<value>  Override the api version used for api requests made by this command
      --dry-run              Preview the selected normal or force deletion without mutating the org.
      --force                Force-delete one version using an interactive impact preview and typed Flow name/version
                             confirmation.
      --namespace=<value>    Namespace of the Flow; omit for an unmanaged Flow.
      --versions=<value>...  (required) Version number or inclusive range; repeat the flag for multiple values.
                             Comma-separated values are also supported. With --force, specify exactly one number.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Delete selected Flow versions normally, or force-delete one version with interactive confirmation.

  Select versions of one Flow by API name. Use --namespace separately for a namespaced Flow. API 67.0 or later is
  required.

  Repeat --versions to select multiple numbers or inclusive ranges, for example --versions 1 --versions 3-5.
  Comma-separated values remain supported, including when mixed with repeated flags. The selection is limited to 200
  distinct versions. Each requested version receives a result; missing or blocked versions do not remove eligible
  siblings from the request.

  Normal deletion displays the exact selection and asks for confirmation when input and output are terminals. The prompt
  defaults to no and allows 60 seconds. Use -p or --no-prompt to explicitly authorize deletion without a prompt. The
  compatibility flags --yes and -y still work. With --json, or without an interactive terminal, the command previews
  unless --no-prompt is specified. --dry-run always previews, including when an approval flag is also supplied.

  A normal preview assesses the selected versions and deletes nothing. During execution, Core checks each exact version
  independently and reports deleted, blocked or failed. Already-deleted versions are successful acknowledgements.
  Missing versions are never replaced, and earlier successes are not rolled back. Active, packaging, interview,
  wait-condition, last-version and permission restrictions are evaluated by Core.

  Value options also accept the compatible bare name/value form: target-org my-org flow MyFlow versions 1,2,4-6. Bare
  and dashed options can be mixed, including repeated versions. Supported bare names are target-org, flow, versions,
  namespace and api-version. Boolean options still require dashes. Singleton value options cannot be repeated.

  The JSON result uses one versioned public structure with results, summary and blockingReasons. Prepared SDK plans are
  not included. A completed preview exits 0 even when selected versions are blocked. Execution exits 0 when all
  requested actions succeed, 68 for confirmed partial success, and 1 for wholly blocked, failed or unconfirmed outcomes.
  Cancellation exits 1, invalid usage exits 2, and an actual confirmation deadline expires with exit 69. Unconfirmed
  outcomes remain explicit and require reconciliation before another attempt; requests are not automatically retried.

  Force deletion

  --force accepts exactly one positive version number. Commas, ranges and repeated --versions flags are rejected before
  any API call. Force deletion requires interactive input and output, including --dry-run, and cannot be used with
  --json. It shows the impact from Core before execution. Saved-interview and scheduled-work reasons describe the impact
  that force deletion can remove; Active, packaging, access, reference, incomplete evaluation and unsupported-status
  restrictions still block execution. Running or unsupported interview statuses also block execution.

  Force execution always requires typing the exact Flow API name and version number. --no-prompt, --yes and -y cannot
  bypass either prompt. The two prompts share a two-minute deadline. A mismatch or cancellation exits 1; expiration
  exits 69. Both cases send no force-delete execution request. --dry-run only displays the impact.

  Force deletion abandons affected saved interviews and deletes the selected version. The saved data cannot be resumed
  or retried. Delete requires the ForceDeleteFlowVersions user permission; the CLI does not grant it. Acknowledged
  IN_PROGRESS responses continue the same exact version. Blocked, failed, unknown or HTTP-error responses stop further
  calls. Reconcile an interrupted or unconfirmed deletion before another attempt.

EXAMPLES
  Assess a mixed selection without deleting anything:

    $ sf flow version delete --target-org my-org --flow MyFlow --versions 1 --versions 2 --versions 4-6 --dry-run

  Select versions and confirm interactively:

    $ sf flow version delete --target-org my-org --flow MyFlow --versions 1-3

  Use equivalent bare name/value pairs:

    $ sf flow version delete target-org my-org flow MyFlow versions 1-3

  Approve the exact selection and return JSON:

    $ sf flow version delete --target-org my-org --flow MyFlow --versions 1-3 --no-prompt --json

  Preview force-deletion impact for one version from an interactive terminal:

    $ sf flow version delete --target-org my-org --flow MyFlow --versions 2 --force --dry-run

  Review force-deletion impact and type the Flow name and version to confirm:

    $ sf flow version delete --target-org my-org --flow MyFlow --versions 2 --force
```

_See code: [src/commands/flow/version/delete.ts](https://github.com/salesforcecli/plugin-flow/blob/v2.0.2/src/commands/flow/version/delete.ts)_

## `sf flow version list`

List Flow versions, reference and interview counts, and deletion eligibility.

```
USAGE
  $ sf flow version list -o <value> [--json] [--flags-dir <value>] [--api-version <value>] [-f <value> | --all]
    [--namespace <value>] [--status <value>] [--older-than <value>] [--min-percent <value>] [--deletable]

FLAGS
  -f, --flow=<value>         Exact Flow API name, qualified with its namespace when applicable; mutually exclusive with
                             --all.
  -o, --target-org=<value>   (required) Username or alias of the target org. Not required if the `target-org`
                             configuration variable is already set.
      --all                  List versions for all Flows in the org; mutually exclusive with --flow.
      --api-version=<value>  Override the api version used for api requests made by this command
      --deletable            Show backend PASS versions; the server retains assessment errors.
      --min-percent=<value>  Show Flows at or above this percentage of their configured version limit (0-100).
      --namespace=<value>    Unsupported by the Core list API; use --flow with the qualified API name instead.
      --older-than=<value>   Show versions at least this many whole days old since CreatedDate, from 0d to 36500d.
      --status=<value>       Filter by active, inactive (all non-Active), draft, obsolete, invaliddraft or underreview;
                             case-insensitive.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  List Flow versions, reference and interview counts, and deletion eligibility.

  Read Flow versions through the authenticated Core Connect list API. Choose exactly one scope: --flow for an exact Flow
  API name, including its namespace prefix when applicable, or --all for every Flow in the org. No Flow name, org, count
  or version limit is hardcoded. The Core list contract has no separate namespace filter; --namespace is rejected. Use a
  qualified --flow name instead.

  The console includes the A3/C1 fields: Flow version name, version number, status, age, creator, creation date,
  last-modified date, reference count, paused and failed interview counts, and whether the version is deletable, with
  the full server reason when it is not. Standard Salesforce CLI tables wrap complete values. Normal-width consoles use
  Field/Value tables. JSON preserves raw IDs and server values.

  API 67.0 or later and POST /connect/interaction/flow-versions/list are required. HTTP 201 is success even when
  versions are BLOCKED or ERROR. The SDK follows every nextOffset, including empty pages. This command does not query
  Tooling inventory or the separate deletion-assessment API.

  Native status filters are case-insensitive: active, draft, obsolete, invaliddraft and underreview. Inactive is a
  compatibility alias: the SDK retrieves list pages without a server status filter, then displays non-Active rows. ERROR
  rows with unavailable status remain visible. --older-than accepts whole days from CreatedDate, from 0d to 36500d.
  --deletable requests PASS rows; the server also retains ERROR rows. --min-percent uses the Flow's complete version
  count before filtering and actual org version limit. The CLI preserves the server's integer percentage. A zero limit
  and null percentage remain explicit; its product filtering rule is still open.

  PASS displays Deletable Yes. BLOCKED displays No and the complete backend message. ERROR displays Error: that version
  was not fully assessed. The CLI does not create local blockers or replace unavailable metadata/counts with zero. All
  three counts come directly from the list response. The reference-count counting unit remains subject to product-owner
  confirmation.

  JSON now follows Core contractVersion 1 with grouped flows and direct per-version counts, deletable, outcome,
  reasonCode and message. It replaces obsolete client format 6 and its flat rows and repeated error arrays.
  returnedVersionCount is the displayed aggregate. candidateVersionCount is the server's candidate/prefix metric, not a
  complete org total. A server listTruncated flag or any per-version ERROR produces exit status 1 after the report is
  returned. BLOCKED alone leaves status 0. A failed or malformed whole request returns a typed error instead of
  fabricated inventory.

  No Flow, interview, reference or business record is modified. This command never calls Tooling DELETE and requires no
  confirmation. A later deletion still runs current backend validation.

EXAMPLES
  List versions of one Flow:

    $ sf flow version list --target-org my-org --flow MyFlow

  List versions of a namespaced Flow using its qualified API name:

    $ sf flow version list --target-org my-org --flow billing__MyFlow

  Find Flows using at least 80 percent of their configured version limit:

    $ sf flow version list --target-org my-org --all --min-percent 80

  Return backend PASS versions and any assessment errors as JSON:

    $ sf flow version list --target-org my-org --flow MyFlow --deletable --json

  Return older inactive versions as JSON:

    $ sf flow version list --target-org my-org --flow MyFlow --status inactive --older-than 90d --json
```

_See code: [src/commands/flow/version/list.ts](https://github.com/salesforcecli/plugin-flow/blob/v2.0.2/src/commands/flow/version/list.ts)_

## `sf flow version prune`

Preview or execute retention cleanup for one Flow or all Flows in an org.

```
USAGE
  $ sf flow version prune -o <value> [--json] [--flags-dir <value>] [--api-version <value>] [-f <value> | --all]
    [--keep-latest <value>] [--older-than <value>] [--dry-run] [--execute] [-p]

FLAGS
  -f, --flow=<value>         Fully qualified Flow API name; choose --flow or --all.
  -o, --target-org=<value>   (required) Username or alias of the target org. Not required if the `target-org`
                             configuration variable is already set.
  -p, --no-prompt            Approve deletion of the exact cleanup candidates without prompting; --yes and -y remain
                             compatibility aliases.
      --all                  Evaluate every Flow in the org, after paging the complete C1 catalog.
      --api-version=<value>  Override the api version used for api requests made by this command
      --dry-run              Preview the retention plan without deletion; overrides execution and approval flags, and is
                             the default.
      --execute              Request interactive confirmation; with JSON or no terminal, preview unless --no-prompt is
                             supplied.
      --keep-latest=<value>  [default: 5] Number of latest versions to keep by version number (at least 1; default 5).
      --older-than=<value>   [default: 90d] Minimum age in UTC days, such as 90d (inclusive; default 90d).

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Preview or execute retention cleanup for one Flow or all Flows in an org.

  Defaults to a preview. Core's C1 list is paged in full, without status, age or deletable filters, before the CLI
  applies the retention policy. No new backend endpoint is required. Use API 67.0 or later and a Core server that
  returns statusChangeDate. A server omitting that field produces an actionable error rather than guessing a rollback
  version.

  Keep the Active version, the latest N by version number (default 5), and the Obsolete version with the newest
  statusChangeDate. A null timestamp never wins over a real timestamp. As a conservative interim rule, keep every
  version tied at the newest timestamp; when all Obsolete timestamps are null, keep all Obsolete versions. Packaging can
  stamp statusChangeDate, so this rule is not proof of the historical previous activation. Do not substitute
  lastModifiedDate for activation history. This interim rule is distinct from the production B1 rule, which uses Last
  Modified Date and protects Active plus the latest N. The client will adopt shared B1 selection after its contract is
  agreed.

  Only inactive versions outside those protections, old enough according to Core's ageDays (default at least 90 UTC
  days), and marked PASS/deletable by Core are candidates. ERROR is not deletable. Incomplete catalogs or missing
  required policy metadata do not authorize deletion.

  Use --execute for an interactive confirmation, which defaults to no and allows 60 seconds. Use --no-prompt (or -p) to
  approve the exact cleanup selection without prompting. The previous --yes and -y spellings remain compatibility
  aliases. Without either execution option, nothing is deleted, even in an interactive terminal. With --json or without
  interactive input and output terminals, --execute acts as a preview unless --no-prompt is also specified. An explicit
  --dry-run always previews, including when approval or execution flags are supplied.

  Execution preserves the exact previewed version IDs. Each candidate goes through the C2 normal-delete service: current
  list-based identity, a fresh complete C1 retention check, and then the Core bulk-delete POST if the same exact version
  is still a cleanup candidate. Core performs mutation-time checks and returns its per-version outcome, reason and
  message. Known blocked and failed items do not stop eligible siblings. An unconfirmed deletion outcome or org-context
  change stops later mutations. Client checks cannot atomically reserve retention state against other writers. No force
  deletion, reference removal or interview abandonment is performed.

  JSON contract 3 returns results, summary, per-version blockingReasons, rule, impact and warnings. Internal prepared
  plans and deletion-service objects are not returned. A completed preview or successful execution exits 0. Wholly
  blocked, failed, uncertain or cancelled execution exits 1. Invalid usage exits 2, partial success exits 68, and an
  actual confirmation timeout exits 69. The standard JSON envelope status mirrors the exit code. Protected versions are
  reported as kept, and preview rows never count as successful deletions.

EXAMPLES
  Preview one Flow using the default keep count and age:

    $ sf flow version prune --target-org my-org --flow MyFlow

  Preview an explicit retention rule:

    $ sf flow version prune --target-org my-org --flow MyFlow --keep-latest 5 --older-than 90d --dry-run

  Review and confirm interactively:

    $ sf flow version prune --target-org my-org --flow MyFlow --execute

  Explicitly authorize org-wide cleanup and return JSON:

    $ sf flow version prune --target-org my-org --all --keep-latest 5 --older-than 90d --no-prompt --json
```

_See code: [src/commands/flow/version/prune.ts](https://github.com/salesforcecli/plugin-flow/blob/v2.0.2/src/commands/flow/version/prune.ts)_

<!-- commandsstop -->
