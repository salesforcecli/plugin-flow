# Flow version command integration tests

Build the library and plugin using the documented local development setup. Authorize a dedicated test org through the standard Salesforce CLI login workflow and ensure the required API 67.0+ Flow version endpoints are installed. The suite uses the existing org session; it does not create an org, deploy fixtures, grant permissions or delete versions.

Prepare an isolated Flow fixture with known versions, then explicitly configure it:

```sh
FLOW_VERSION_NUT_TARGET_ORG=my-test-org \
FLOW_VERSION_NUT_FLOW=My_Fixture_Flow \
FLOW_VERSION_NUT_VERSIONS=1,2 \
FLOW_VERSION_NUT_API_VERSION=67.0 \
corepack yarn test:nuts:flow-versions
```

The org must already be authenticated. The Flow name is its qualified API identifier; every selected version must exist. Versions are comma-separated positive numbers for this fixture configuration. The production command independently supports repeated flags and inclusive ranges. API version defaults to 67.0 when omitted. Alias/username, Flow, API and version values are bounded and validated before invoking the testkit shell command. Option-like values and shell metacharacters are rejected.

With no fixture variables, Mocha reports the nine live tests as pending. A partial or invalid configuration fails before launching a child command. A skipped suite is not evidence of a successful integration. The dedicated script excludes the unrelated legacy scratch-org test suite.

The tests launch real CLI child processes through `@salesforce/cli-plugins-testkit` using the local compiled plugin from a temporary working directory. An explicit absolute `TESTKIT_EXECUTABLE_PATH` can select another approved CLI installation when required; ensure it contains the intended plugin build.

The suite checks one-Flow and org-wide listing, repeated version selection, explicit normal preview, implicit JSON/nonterminal previews, retention preview and JSON `--execute` preview, and force JSON/nonterminal rejection. It validates JSON envelopes, report schemas, exact target IDs and zero acknowledged deletions in previews. It re-reads every fixture definition/version ID after each case and requires them to remain unchanged.

No approval flag appears in the live suite. Force cases use `--dry-run` and verify invalid usage before force processing. Actual deletion, interview abandonment, permission enforcement, audit, concurrent mutations and rollback require separately approved disposable fixtures and mutation integration tests; this read-only suite does not certify them.

For local unit, type and lint checks:

```sh
corepack yarn test
corepack yarn prettier --check 'src/**/*.ts' 'test/**/*.ts' 'schemas/**/*.json' command-snapshot.json
```

Command schemas under `schemas/` are generated from TypeScript for reproducible CLI tooling. The strict C1 semantic contract is preserved in `test/contracts/flow-version-list.json`; positive command reports validate both and negative semantic cases remain covered. Wireit tracks contract JSON so fixture-only changes rerun the unit checks.
