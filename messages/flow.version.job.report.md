# summary

Report the status and per-version results of an existing Flow version job.

# description

Use the job ID printed when an async Flow version job is queued. Read /xds/operation/{jobId} using the authenticated org and API 67.0 or later. For a finished job, also read the BackgroundOperation Status, Result and Error fields when the status response omits or masks the details. This command does not poll, submit, cancel or resume jobs, or delete versions.

Display the job ID and its actual status: Scheduled, Running, Complete or Error. Scheduled and Running return an empty versions array; run this command again later for a new snapshot. Closing the CLI does not cancel the server job.

For Complete and Error jobs, display each stored version outcome (DELETED, BLOCKED, FAILED or NOT ASSESSED) and its reason. A Complete job can include versions that weren't deleted. When the job is Error, display its stored error text as well. Report selection limits and truncated results as warnings; missing results never imply successful deletion.

Exit 0 for a successful report showing Scheduled, Running or Complete. Exit 1 when the job reports Error, a required read fails, or a response cannot be validated. Missing or invalid command arguments exit 2. A 404 can mean that the ID is missing, invalid or inaccessible; it is not evidence that a job completed or was cancelled.

Use --json for automation. The result includes jobId, jobStatus, error, truncated and versions, plus warnings, notes, targetOrg and apiVersion. Each version has flowApiName, versionId, outcome and reason. Missing Flow names and reasons are null. The status field remains an alias of jobStatus for compatibility. The standard JSON envelope status is the command exit code.

# examples

- Check a job using the ID returned by async prune:

  <%= config.bin %> <%= command.id %> --target-org my-org --api-version 69.0 --job-id 08P000000000001

- Return the current status and stored version results as JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org --api-version 69.0 --job-id 08P000000000001 --json

# flags.job-id.summary

Job ID returned by an async Flow version operation.

# title

=== Flow version job report

# target

Target org: %s | API: %s

# job

Job ID: %s

# status

Status: %s

# jobError

Job error: %s

# missingJobError

No error text was stored by the server.

# warning

Warning: %s

# unrecognizedResultLine

Unrecognized job result line: %s

# columns.flow

Flow

# columns.version

Version ID

# columns.outcome

Outcome

# columns.reason

Reason
