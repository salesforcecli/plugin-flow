# summary

Delete selected Flow versions normally, or force-delete one version with interactive confirmation.

# description

Select versions of one Flow by API DeveloperName and resolve exact version IDs in the target org. No Flow name, org or version ID is hardcoded. Use --namespace separately for namespaced Flows. API 67.0 or later is required for the existing deletion-assessment API.

--versions accepts a single number, comma-separated numbers or inclusive ranges, for example 1,2,4-6, with at most 200 distinct selected versions. Every requested number receives a result. Missing, Active, and otherwise blocked versions do not reject the entire selection. No replacement version is chosen when an exact target disappears.

--dry-run resolves the selection and calls POST /connect/interaction/flow-versions/deletion-assessment. It shows actual backend PASS, BLOCKED or ERROR results and missing-version errors without sending DELETE. A completed dry run exits 0, including blocked or errored items. A whole-request failure still returns an error. Preview is an observation, not a guarantee that a later deletion will succeed.

For NORMAL execution, the SDK rechecks exact target identity and freshly assesses each version after confirmation. BLOCKED versions preserve the backend's complete reason and evidence and do not stop eligible siblings. Assessment ERROR is a failed item and does not authorize DELETE. Only PASS proceeds to DELETE /tooling/sobjects/Flow/{versionId}. A conclusive successful deletion reports SUCCEEDED; a conclusive delete rejection reports FAILED with the platform error. Each version is independent; earlier successes are not rolled back.

The existing client preservation safeguard retains at least one version while the product decision about deleting the last remaining version is open. It applies per item and is explicitly identified as client policy, not an invented backend restriction. There is no blanket protection for the latest inactive version when another version remains. Client checks do not provide an atomic concurrency guarantee.

Value options also accept bare name/value pairs: target-org my-org flow MyFlow versions 1,2,4-6. This is equivalent to --target-org my-org --flow MyFlow --versions 1,2,4-6, and both forms can be mixed. Supported bare names are target-org, flow, versions, namespace and api-version. Boolean options such as --dry-run, --yes and --json still require dashes. Duplicate value options and malformed arguments are rejected.

Without --yes, NORMAL interactive execution displays the complete plan and waits 60 seconds for confirmation, defaulting to no. Timeout or Ctrl-C closes the prompt and cancels without deletion. Non-interactive and JSON NORMAL execution require --yes. --dry-run never requires confirmation. Confirmation covers the exact selected targets, not arbitrary org changes. FORCE uses the separate typed confirmation described below.

JSON contract 2 contains the assessed plan and per-version execution results, including the source of a reason. Exit 0 means all requested deletions succeeded or a dry run completed. Exit 1 means execution had blocked items and no failed or uncertain items. Exit 2 means any item failed, has an unconfirmed deletion outcome, or was not attempted after execution stopped. Cancellation exits 0.

Transport retries and redirects are disabled for DELETE. Native authentication refresh remains in the Salesforce SDK. A timeout, lost response or inconclusive server error is reported as UNKNOWN with targetDeleted null; remaining versions are NOT_ATTEMPTED. These exceptional results must not be relabeled as confirmed failures, retried automatically, or treated as rollback. Org changes stop further execution. Normal deletion does not abandon interviews or remove references.

--force selects the separate C6 backend and accepts exactly one version number, with no commas or ranges. It never adds a force flag to Tooling DELETE. It requires both input and output terminals to be interactive, including --force --dry-run. The backend preview supplies eligibility and impact. A blocked preview never executes. --dry-run displays the force preview without prompting or deleting; a completed preview exits 0.

Force execution always displays the impact and requires typing the exact Flow API name and version number into two empty prompts. --yes is ignored in force mode and cannot bypass either prompt. Timeout, Ctrl-C or a mismatch cancels. The confirmation window is normally two minutes and never shorter than one minute; an expiring preview requires a fresh command. JSON force execution also requires an interactive stderr: the human preview and prompts go to stderr, and the final JSON stays on stdout. Redirected input/output and CI execution are rejected.

Force preview calls POST /connect/interaction/flow-versions/force-delete/preview with exact version and definition IDs. Execution sends only the private, single-use confirmation token to POST /connect/interaction/flow-versions/force-delete. Typed text and CLI flags are not sent to the backend. Tokens are never included in console/JSON reports. A stale or rejected token requires a fresh preview and typed confirmation; it is not automatically retried. A lost or inconclusive execution response is UNKNOWN and requires reconciliation before another attempt.

Force JSON uses mode FORCE and contract 1, documented in schemas/flow-version-force-delete.json. Normal mode retains contract 2 in schemas/flow-version-delete.json. Force execution exits 0 for success or cancellation, 1 for blocked, and 2 for failed or uncertain. Force execution requires a backend that enforces the dedicated Force Delete Flow Versions permission, org-level disable, token authorization, audit and runtime cleanup. CLI interactivity does not replace backend authorization.

# examples

- Assess a mixed selection without deleting anything:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 1,2,4-6 --dry-run

- Select versions and confirm interactively:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 1-3

- Use equivalent bare name/value pairs:

  <%= config.bin %> <%= command.id %> target-org my-org flow MyFlow versions 1-3

- Approve the exact selection and return JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 1-3 --yes --json

- Preview force-deletion impact for one version from an interactive terminal:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 2 --force --dry-run

- Review force-deletion impact and type the Flow name and version to confirm:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow MyFlow --versions 2 --force

# flags.flow.summary

API DeveloperName of the Flow, without its namespace prefix.

# flags.versions.summary

Explicit version numbers or inclusive ranges, for example 1,2,4-6. With --force, exactly one version number is required.

# flags.namespace.summary

Namespace of the Flow; omit for an unmanaged Flow.

# flags.dry-run.summary

Preview the selected normal or force deletion without mutating the org.

# flags.yes.summary

Approve normal deletion without prompting; ignored by --force, which always requires typed confirmation.

# flags.force.summary

Force-delete one version using an interactive impact preview and typed Flow name/version confirmation.

# confirmationRequired

Non-interactive or JSON deletion requires --yes. Use --dry-run first to inspect the assessed selection.

# confirmDelete

Process deletion for these %s requested Flow versions from %s? You have 60 seconds to respond; no response cancels deletion. Every target is reassessed before deletion and each version has its own result.

# cancelled

Deletion cancelled. No deletion requests were sent.

# dryRunNotice

Dry run only. No deletion requests were sent. Assessment reflects current state; execution reassesses each exact target.

# forceSingleVersion

Force deletion accepts exactly one positive version number, for example --versions 2. Commas and ranges are not allowed.

# forceInteractiveRequired

Force deletion requires interactive input and output terminals, including dry run. JSON execution also requires interactive stderr for its impact preview and typed prompts. --yes cannot bypass this requirement.

# forceIrreversible

Force deletion abandons the affected saved interviews and deletes this Flow version. Abandonment deletes their saved data; those interviews cannot be resumed or retried. This action cannot be undone.

# forceNoMutation

No force-delete execution request has been sent.

# forceUnknown

The force-delete outcome is unconfirmed. Reconcile this exact Flow version and its interviews before another attempt. No automatic retry was sent.

# forcePreviewExpiring

The force preview has less than one minute remaining or its expiry is unavailable. Nothing was executed. Run a fresh preview and complete typed confirmation; an expired token is never refreshed automatically.

# forceYesIgnored

--yes is ignored for force deletion. You must type the exact Flow API name and version number below.

# forceInvalidPreview

The force preview does not identify the exact Flow name and version required for confirmation. Nothing was executed.

# forceConfirmFlow

Type the exact Flow API name (%s)

# forceConfirmVersion

Type the exact version number (%s)

# forceCancelled

Force deletion cancelled. No force-delete execution request was sent.
