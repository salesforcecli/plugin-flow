# summary

Preview or execute retention cleanup for one Flow or all Flows in an org.

# description

Defaults to a preview. Core's C1 list is paged in full, without status, age or deletable filters, before the CLI applies the retention policy. No new backend endpoint is required. Use API 67.0 or later and a Core server that returns statusChangeDate. A server omitting that field produces an actionable error rather than guessing a rollback version.

Keep the Active version, the latest N by version number (default 5), and the Obsolete version with the newest statusChangeDate. A null timestamp never wins over a real timestamp. As a conservative interim rule, keep every version tied at the newest timestamp; when all Obsolete timestamps are null, keep all Obsolete versions. Packaging can stamp statusChangeDate, so this rule is not proof of the historical previous activation. Do not substitute lastModifiedDate for activation history. This interim rule is distinct from the production B1 rule, which uses Last Modified Date and protects Active plus the latest N. The client will adopt shared B1 selection after its contract is agreed.

Only inactive versions outside those protections, old enough according to Core's ageDays (default at least 90 UTC days), and marked PASS/deletable by Core are candidates. ERROR is not deletable. Incomplete catalogs or missing required policy metadata do not authorize deletion.

Use --execute for an interactive confirmation, which defaults to no and allows 60 seconds. Use --no-prompt (or -p) to approve the exact cleanup selection without prompting. The previous --yes and -y spellings remain compatibility aliases. Without either execution option, nothing is deleted, even in an interactive terminal. With --json or without interactive input and output terminals, --execute acts as a preview unless --no-prompt is also specified. An explicit --dry-run always previews, including when approval or execution flags are supplied.

Execution preserves the exact previewed version IDs. Each candidate goes through the C2 normal-delete service: current list-based identity, a fresh complete C1 retention check, and then the Core bulk-delete POST if the same exact version is still a cleanup candidate. Core performs mutation-time checks and returns its per-version outcome, reason and message. Known blocked and failed items do not stop eligible siblings. An unconfirmed deletion outcome or org-context change stops later mutations. Client checks cannot atomically reserve retention state against other writers. No force deletion, reference removal or interview abandonment is performed.

JSON contract 3 returns results, summary, per-version blockingReasons, rule, impact and warnings. Internal prepared plans and deletion-service objects are not returned. A completed preview or successful execution exits 0. Wholly blocked, failed, uncertain or cancelled execution exits 1. Invalid usage exits 2, partial success exits 68, and an actual confirmation timeout exits 69. The standard JSON envelope status mirrors the exit code. Protected versions are reported as kept, and preview rows never count as successful deletions.

# examples

- Preview one Flow using the default keep count and age:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow

- Preview an explicit retention rule:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --keep-latest 5 --older-than 90d --dry-run

- Review and confirm interactively:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --execute

- Explicitly authorize org-wide cleanup and return JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org --all --keep-latest 5 --older-than 90d --no-prompt --json

# flags.flow.summary

Fully qualified Flow API name; choose --flow or --all.

# flags.all.summary

Evaluate every Flow in the org, after paging the complete C1 catalog.

# flags.keep-latest.summary

Number of latest versions to keep by version number (at least 1; default 5).

# flags.older-than.summary

Minimum age in UTC days, such as 90d (inclusive; default 90d).

# flags.dry-run.summary

Preview the retention plan without deletion; overrides execution and approval flags, and is the default.

# flags.execute.summary

Request interactive confirmation; with JSON or no terminal, preview unless --no-prompt is supplied.

# flags.no-prompt.summary

Approve deletion of the exact cleanup candidates without prompting; --yes and -y remain compatibility aliases.

# error.scopeRequired

Choose exactly one scope: --flow <API name> or --all.

# error.scopeRequired.actions

Specify --flow with a Flow API name, or use --all to evaluate every Flow.

# error.invalidRetentionPolicy

%s

# error.invalidRetentionPolicy.actions

Use --keep-latest with an integer of at least 1 and --older-than with a duration such as 90d.

# confirmPrune

Delete these %s cleanup candidates from %s? Deletion cannot be undone. You have 60 seconds to respond; without a response, no deletion requests are sent. Retention is checked again before each Core delete request.

# cancelled

Cleanup cancelled. No deletion requests were sent.

# timedOut

Cleanup confirmation timed out. No deletion requests were sent. Preview again before retrying.
