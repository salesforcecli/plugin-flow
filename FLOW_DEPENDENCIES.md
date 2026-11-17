# Flow dependency analysis

`flow dependencies` reads direct relationships for a selected Flow and an explicit scan scope. Run it from the plugin-flow checkout after compiling:

```bash
node bin/run.js flow dependencies \
  --target-org my-org \
  --flow-name Account_Onboarding \
  --scan-flow FirstCaller \
  --scan-flow SecondCaller
```

Names, definition IDs and version IDs are resolved from the authenticated org. `--scan-flow` is optional and repeatable; it selects candidate caller Flows whose metadata will be inspected. It does not request an automatic org-wide scan. The root and explicit caller list are capped at 20 Flow definitions.

The command reads selected Flow metadata and queries the dependency API for incoming/outgoing records. API-reported Apex callers can be displayed without supplying an Apex class name. A relationship to a Flow definition does not establish a dependency on a particular inactive version and is not a deletion assessment.

Use `--version-policy latest` (the default) or `--version-policy active`. Active requires an active version for every explicitly selected Flow and does not silently fall back. Flow names are DeveloperName values; `--namespace` applies to the root and explicit scan Flows.

Console output includes the root identity and incoming/outgoing evidence. `--json` also returns scan scope, provider status and coverage warnings. Empty or limited dependency-API results do not prove that no relationship exists.

This command is read-only. Its supported scope is direct relationships: no recursive traversal, complete caller enumeration, Apex source parser, arbitrary runtime reference discovery, manifest generation or delete eligibility is claimed. Use version-management assessment for normal-delete eligibility.
