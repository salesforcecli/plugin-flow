# summary

List Flow versions, reference and interview counts, and deletion eligibility.

# description

Read Flow versions through the authenticated Core Connect list API. Choose exactly one scope: --flow for an exact Flow API name, including its namespace prefix when applicable, or --all for every Flow in the org. No Flow name, org, count or version limit is hardcoded. The Core list contract has no separate namespace filter; --namespace is rejected. Use a qualified --flow name instead.

The console includes the A3/C1 fields: Flow version name, version number, status, age, creator, creation date, last-modified date, reference count, paused and failed interview counts, and whether the version is deletable, with the full server reason when it is not. Standard Salesforce CLI tables wrap complete values. Normal-width consoles use Field/Value tables. JSON preserves raw IDs and server values.

API 67.0 or later and POST /connect/interaction/flow-versions/list are required. HTTP 201 is success even when versions are BLOCKED or ERROR. The SDK follows every nextOffset, including empty pages. This command does not query Tooling inventory or the separate deletion-assessment API.

Native status filters are case-insensitive: active, draft, obsolete, invaliddraft and underreview. Inactive is a compatibility alias: the SDK retrieves list pages without a server status filter, then displays non-Active rows. ERROR rows with unavailable status remain visible. --older-than accepts whole days from CreatedDate, from 0d to 36500d. --deletable requests PASS rows; the server also retains ERROR rows. --min-percent uses the Flow's complete version count before filtering and actual org version limit. The CLI preserves the server's integer percentage. A zero limit and null percentage remain explicit; its product filtering rule is still open.

PASS displays Deletable Yes. BLOCKED displays No and the complete backend message. ERROR displays Error: that version was not fully assessed. The CLI does not create local blockers or replace unavailable metadata/counts with zero. All three counts come directly from the list response. The reference-count counting unit remains subject to product-owner confirmation.

JSON now follows Core contractVersion 1 with grouped flows and direct per-version counts, deletable, outcome, reasonCode and message. It replaces obsolete client format 6 and its flat rows and repeated error arrays. returnedVersionCount is the displayed aggregate. candidateVersionCount is the server's candidate/prefix metric, not a complete org total. A server listTruncated flag or any per-version ERROR produces exit status 1 after the report is returned. BLOCKED alone leaves status 0. A failed or malformed whole request returns a typed error instead of fabricated inventory.

No Flow, interview, reference or business record is modified. This command never calls Tooling DELETE and requires no confirmation. A later deletion still runs current backend validation.

# examples

- List versions of one Flow:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow

- List versions of a namespaced Flow using its qualified API name:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow billing__MyFlow

- Find Flows using at least 80 percent of their configured version limit:

  <%= config.bin %> <%= command.id %> --target-org my-org --all --min-percent 80

- Return backend PASS versions and any assessment errors as JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --deletable --json

- Return older inactive versions as JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --status inactive --older-than 90d --json

# flags.flow.summary

Exact Flow API name, qualified with its namespace when applicable; mutually exclusive with --all.

# flags.all.summary

List versions for all Flows in the org; mutually exclusive with --flow.

# flags.namespace.summary

Unsupported by the Core list API; use --flow with the qualified API name instead.

# flags.status.summary

Filter by active, inactive (all non-Active), draft, obsolete, invaliddraft or underreview; case-insensitive.

# flags.older-than.summary

Show versions at least this many whole days old since CreatedDate, from 0d to 36500d.

# flags.min-percent.summary

Show Flows at or above this percentage of their configured version limit (0-100).

# flags.deletable.summary

Show backend PASS versions; the server retains assessment errors.

# scopeRequired

Choose exactly one scope: --flow <Flow API name> or --all.

# invalidMinPercent

--min-percent must be an integer from 0 to 100.
