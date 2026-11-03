# summary

Preview or execute retention cleanup for one Flow or all Flows in an org.

# description

Defaults to a preview. Core's C1 list is paged in full, without status, age or deletable filters, before the CLI applies the retention policy. No new backend endpoint is required. Use API 67.0 or later and a Core server that returns statusChangeDate. A server omitting that field produces an actionable error rather than guessing a rollback version.

Keep the Active version, the latest N by version number (default 5), and the Obsolete version with the newest statusChangeDate. A null timestamp never wins over a real timestamp. As a conservative interim rule, keep every version tied at the newest timestamp; when all Obsolete timestamps are null, keep all Obsolete versions. Packaging can stamp statusChangeDate, so this rule is not proof of the historical previous activation. Do not substitute lastModifiedDate for activation history. This interim rule is distinct from the production B1 rule, which uses Last Modified Date and protects Active plus the latest N. The client will adopt shared B1 selection after its contract is agreed.

Only inactive versions outside those protections, old enough according to Core's ageDays (default at least 90 UTC days), and marked PASS/deletable by Core are candidates. ERROR is not deletable. Incomplete catalogs or missing required policy metadata do not authorize deletion.

Use --execute for an interactive confirmation, which defaults to no and allows 60 seconds. Use --yes to explicitly authorize non-interactive execution. These options and --dry-run are mutually exclusive. JSON/non-interactive execution requires --yes. Without either execution option, nothing is deleted, even in an interactive terminal.

Execution preserves the exact previewed version IDs. Each candidate goes through the existing C2 normal-delete service: current identity, fresh deletion assessment, a fresh complete C1 retention check, and then Tooling DELETE only if still eligible. Known blocked and failed items do not stop eligible siblings. An unconfirmed deletion outcome or org-context change stops later mutations. Client checks cannot atomically reserve retention state against other writers. No force deletion, reference removal or interview abandonment is performed.

JSON contract 1 includes the policy, every kept/candidate/blocked/error row with reasons, and execution results. A completed preview or cancellation exits 0. Execution exits 1 for blocked items and 2 for failed, unassessed or uncertain items. A whole-request failure is an error.

# examples

- Preview one Flow using the default keep count and age:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow

- Preview an explicit retention rule:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --keep-latest 5 --older-than 90d --dry-run

- Review and confirm interactively:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --execute

- Explicitly authorize org-wide cleanup and return JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org --all --keep-latest 5 --older-than 90d --yes --json

# flags.flow.summary

Fully qualified Flow API name; choose --flow or --all.

# flags.all.summary

Evaluate every Flow in the org, after paging the complete C1 catalog.

# flags.keep-latest.summary

Number of latest versions to keep by version number (at least 1; default 5).

# flags.older-than.summary

Minimum age in UTC days, such as 90d (inclusive; default 90d).

# flags.dry-run.summary

Explicitly preview the retention plan without deletion; preview is the default.

# flags.execute.summary

Display the exact plan and request interactive confirmation before deletion.

# flags.yes.summary

Explicitly authorize deletion of the planned cleanup candidates without prompting.

# scopeRequired

Choose exactly one scope: --flow <API name> or --all.

# confirmationRequired

Non-interactive or JSON cleanup requires --yes. Omit execution options to preview first.

# confirmPrune

Delete these %s cleanup candidates from %s? Deletion cannot be undone. You have 60 seconds to respond; no response cancels. Each exact version is reassessed before deletion.

# cancelled

Cleanup cancelled. No deletion requests were sent.
