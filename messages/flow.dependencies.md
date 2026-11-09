# summary

Inspect direct Flow dependencies and references in a target org.

# description

Resolve the root Flow from --flow-name in --target-org, then read the selected version's metadata and extract its subflow references. Names, definition IDs, and version IDs are resolved from the org on every run; no fixture names or IDs are built into the command. Inspect additional candidate caller Flows when explicitly provided with --scan-flow. Also query MetadataComponentDependency for incoming and outgoing references to the root definition and selected version.

--scan-flow is optional and repeatable. It defines which candidate caller Flows to inspect; it is not an automatic search for every caller in the org. Without it, the command still reads the root Flow and queries the dependency API, but incoming references can be incomplete.

The default version policy is latest, including Draft versions. The active policy requires an active version for every selected Flow; it does not fall back silently. Flow names are DeveloperName values; use --namespace separately. The namespace applies to the root and explicitly selected scan Flows.

This read-only command does not deploy, activate, execute, or delete metadata. It does not scan Apex source, resolve arbitrary runtime references, traverse dependencies recursively, generate a manifest, or claim a complete org-wide impact analysis. Empty dependency-API results do not mean no dependencies. Console output shows the root identity and incoming/outgoing relationships with their evidence. Use --json for structured results, including scan scope, dependency-API status, and coverage warnings.

# examples

- Inspect any Flow by its API DeveloperName in an authenticated org:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow-name MyFlowApiName

- Also inspect two candidate caller Flows without changing the command implementation:

  <%= config.bin %> <%= command.id %> --target-org my-org --flow-name MyFlowApiName --scan-flow FirstCaller --scan-flow SecondCaller

- Select active versions in a namespace and return structured evidence and coverage information:

  <%= config.bin %> <%= command.id %> --target-org my-org --namespace acme --flow-name MyFlowApiName --version-policy active --json

# flags.flow-name.summary

API DeveloperName of the root Flow (without a namespace prefix).

# flags.namespace.summary

Namespace of the root and scanned Flows; omit for unmanaged Flows.

# flags.scan-flow.summary

Additional caller Flow DeveloperName to inspect; repeat for more Flows (20 total including the root).

# flags.version-policy.summary

Select the latest or active version of each explicitly named Flow.


# error.flowReadFailed

Required Flow metadata for %s could not be read%s. No dependency analysis was completed.

# error.flowReadFailed.actions

- Check the target org connection, Flow access, and API version, then retry the command.

# warning.dependencyQueryFailed

MetadataComponentDependency %s query for %s failed%s. This provider's results are incomplete. Check the org connection, dependency API access, and API version, then retry.

# warning.dependencyProviderIncomplete

Warning: MetadataComponentDependency results are incomplete (status: %s). An empty section does not prove that no references exist. Use --json for coverage details.
