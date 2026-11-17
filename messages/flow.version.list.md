# summary

List Flow versions and show whether each can be deleted.

# description

List flow versions.

By default, show a summary of every Flow in the org, ordered by version count. Each summary row contains the Flow API name, version count, and deletable count. Use --flow to list versions of one Flow, with the latest version first.

For each version, show Version, Status, Flow Version Name, Created, Last Modified, Created By, Age, Run in Mode, API Version, Capacity Category, Log Metrics to Data Cloud, Paused, Failed, Autosaved, Saved Interviews, Deletable and Reason. The one-Flow table keeps all columns; long text wraps within its column. Age is Core's returned ageDays value, and the Flow header keeps its full version count and limit.

Read each count directly from the list API. Saved Interviews is the server's savedInterviewCount, not a total calculated in the CLI. HAS_INTERVIEWS displays as INTERVIEWS (n), including INTERVIEWS (0) when a different persisted interview category blocks deletion. Other reason codes stay unchanged. Null count cells stay blank, including on ERROR rows. A missing value never becomes zero. referenceCount is not displayed or queried separately.

--older-than and --deletable filter versions of one Flow and require --flow. Age uses Last Modified Date: --older-than 90d includes only versions modified strictly more than 90 days ago. Versions with no last-modified date don't match an age filter. --deletable includes only versions the backend assessed as deletable.

JSON uses the standard sf envelope. Org summaries omit the versions array. Single-Flow version details retain the API field names: versionNumber, status, versionName, createdDate, lastModifiedDate, createdByName, ageDays, runInMode, apiVersion, capacityCategory, areMetricsLoggedToDataCloud, pausedInterviewCount, failedInterviewCount, autosavedInterviewCount, savedInterviewCount, deletable, reasonCode and message. Outcome, blockingReasons and error distinguish a blocked version from an assessment error. The API's deletable value is preserved; ERROR never authorizes deletion. Missing optional fields and unavailable counts are null. JSON preserves false and zero values.

This command only reads data and never deletes versions or interviews. A later delete performs its own validation. To preview a cleanup, run 'sf flow version prune --target-org <org> --flow <Flow API name> --dry-run'.

# examples

- Show a summary of every Flow in the org:

  <%= config.bin %> <%= command.id %> --target-org prod

- List all versions of one Flow:

  <%= config.bin %> <%= command.id %> --target-org prod --flow Account_Onboarding

- List deletable versions last modified more than 90 days ago and return JSON:

  <%= config.bin %> <%= command.id %> --target-org prod --flow Account_Onboarding --older-than 90d --deletable --json

# flags.flow.summary

Flow API name. Omit it to show a summary of every Flow in the org.

# flags.all.summary

Compatibility option for the default org-wide summary; mutually exclusive with --flow.

# flags.namespace.summary

Unsupported by the list API; use --flow with the qualified API name instead.

# flags.status.summary

Compatibility filter for active, inactive, draft, obsolete, invaliddraft or underreview.

# flags.older-than.summary

Show versions last modified more than this long ago, such as 90d. Requires --flow.

# flags.min-percent.summary

Compatibility filter for version-limit utilization (0-100).

# flags.deletable.summary

Show only versions that can be deleted. Requires --flow.

# error.flowRequiredForFilters

--older-than and --deletable require --flow <Flow API name>.

# error.flowRequiredForFilters.actions

Specify --flow when filtering versions by age or deletability.

# error.invalidAge

--older-than must be whole days from 0d through 36500d, for example 90d.

# error.invalidAge.actions

Use a whole-day duration such as --older-than 90d.

# error.invalidMinPercent

--min-percent must be an integer from 0 to 100.

# error.invalidMinPercent.actions

Set --min-percent to an integer from 0 through 100.

# error.invalidInput

%s

# error.invalidInput.actions

Check the Flow name and filter options. Use API version 67.0 or later and a qualified Flow name for namespaced Flows.

# warning.truncated

The server returned an incomplete Flow catalog. Displayed versions and totals must not be treated as a complete inventory.

# warning.assessmentErrors

Some versions could not be assessed. Their deletion eligibility and affected totals remain unavailable.
