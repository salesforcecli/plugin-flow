# summary

Delete selected Flow versions normally, or force-delete one version with interactive confirmation.

# description

Select versions of one Flow by API name. Use --namespace separately for a namespaced Flow. API 67.0 or later is required.

Repeat --versions to select multiple numbers or inclusive ranges, for example --versions 1 --versions 3-5. Comma-separated values remain supported, including when mixed with repeated flags. The selection is limited to 200 distinct versions. Each requested version receives a result; missing or blocked versions do not remove eligible siblings from the request.

Normal deletion displays the exact selection and asks for confirmation when input and output are terminals. The prompt defaults to no and allows 60 seconds. Use -p or --no-prompt to explicitly authorize deletion without a prompt. The compatibility flags --yes and -y still work. With --json, or without an interactive terminal, the command previews unless --no-prompt is specified. --dry-run always previews, including when an approval flag is also supplied.

A normal preview assesses the selected versions and deletes nothing. During execution, Core checks each exact version independently and reports deleted, blocked or failed. Already-deleted versions are successful acknowledgements. Missing versions are never replaced, and earlier successes are not rolled back. Active, packaging, interview, wait-condition, last-version and permission restrictions are evaluated by Core.

Value options also accept the compatible bare name/value form: target-org my-org flow MyFlow versions 1,2,4-6. Bare and dashed options can be mixed, including repeated versions. Supported bare names are target-org, flow, versions, namespace and api-version. Boolean options still require dashes. Singleton value options cannot be repeated.

The JSON result uses one versioned public structure with results, summary and blockingReasons. Prepared SDK plans are not included. A completed preview exits 0 even when selected versions are blocked. Execution exits 0 when all requested actions succeed, 68 for confirmed partial success, and 1 for wholly blocked, failed or unconfirmed outcomes. Cancellation exits 1, invalid usage exits 2, and an actual confirmation deadline expires with exit 69. Unconfirmed outcomes remain explicit and require reconciliation before another attempt; requests are not automatically retried.

Force deletion

--force accepts exactly one positive version number. Commas, ranges and repeated --versions flags are rejected before any API call. Force deletion requires interactive input and output, including --dry-run, and cannot be used with --json. It shows the impact from Core before execution. Saved-interview and scheduled-work reasons describe the impact that force deletion can remove; Active, packaging, access, reference, incomplete evaluation and unsupported-status restrictions still block execution. Running or unsupported interview statuses also block execution.

Force execution always requires typing the exact Flow API name and version number. --no-prompt, --yes and -y cannot bypass either prompt. The two prompts share a two-minute deadline. A mismatch or cancellation exits 1; expiration exits 69. Both cases send no force-delete execution request. --dry-run only displays the impact.

Force deletion abandons affected saved interviews and deletes the selected version. The saved data cannot be resumed or retried. Delete requires the ForceDeleteFlowVersions user permission; the CLI does not grant it. Acknowledged IN_PROGRESS responses continue the same exact version. Blocked, failed, unknown or HTTP-error responses stop further calls. Reconcile an interrupted or unconfirmed deletion before another attempt.

# examples

- Assess a mixed selection without deleting anything:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 1 --versions 2 --versions 4-6 --dry-run

- Select versions and confirm interactively:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 1-3

- Use equivalent bare name/value pairs:

  <%= config.bin %> <%= command.id %> target-org my-org flow MyFlow versions 1-3

- Approve the exact selection and return JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 1-3 --no-prompt --json

- Preview force-deletion impact for one version from an interactive terminal:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 2 --force --dry-run

- Review force-deletion impact and type the Flow name and version to confirm:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 2 --force

# flags.flow.summary

API DeveloperName of the Flow, without its namespace prefix.

# flags.versions.summary

Version number or inclusive range; repeat the flag for multiple values. Comma-separated values are also supported. With --force, specify exactly one number.

# flags.namespace.summary

Namespace of the Flow; omit for an unmanaged Flow.

# flags.dry-run.summary

Preview the selected normal or force deletion without mutating the org.

# flags.no-prompt.summary

Authorize normal deletion without prompting; ignored by --force, which requires typed confirmation.

# flags.force.summary

Force-delete one version using an interactive impact preview and typed Flow name/version confirmation.

# confirmDelete

Process deletion for these %s requested Flow versions from %s? You have 60 seconds to respond; no response cancels deletion. Core checks each target during the bulk delete and returns a separate result for every version.

# cancelled

Deletion cancelled. No deletion requests were sent.

# dryRunNotice

Dry run only. No deletion requests were sent. Assessment reflects current state; Core checks each exact target again during execution.

# error.forceSingleVersion

Force deletion accepts exactly one positive version number, for example --versions 2. Commas, ranges and repeated --versions flags are not allowed.

# error.forceSingleVersion.actions

Run the command with one --versions flag containing a single version number.

# error.forceInteractiveRequired

Force deletion requires interactive input and output terminals, including dry run. Approval flags cannot bypass this requirement.

# error.forceInteractiveRequired.actions

Run the command in an interactive terminal without redirected input or output.

# error.forceJsonUnsupported

Force deletion cannot be used with --json, including dry run.

# error.forceJsonUnsupported.actions

Remove --json and run the command in an interactive terminal.

# forceIrreversible

Force deletion abandons the affected saved interviews and deletes this Flow version. Abandonment deletes their saved data; those interviews cannot be resumed or retried. This action cannot be undone.

# forceNoMutation

No force-delete execution request has been sent.

# forceUnknown

The force-delete outcome is unconfirmed. Reconcile this exact Flow version and its interviews before another attempt. No automatic retry was sent.

# forceYesIgnored

--no-prompt and its compatibility aliases are ignored for force deletion. You must type the exact Flow API name and version number below.

# forceInvalidPreview

The force preview does not identify the exact Flow name and version required for confirmation. Nothing was executed.

# forceConfirmFlow

Type the exact Flow API name (%s)

# forceConfirmVersion

Type the exact version number (%s)

# forceCancelled

Force deletion cancelled. No force-delete execution request was sent.

# confirmationTimedOut

Deletion confirmation timed out. No deletion requests were sent.

# forceConfirmationTimedOut

Force deletion confirmation timed out. No force-delete execution request was sent.
