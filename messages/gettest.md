# summary

Display test results for a specific asynchronous test run.

# description

Provide a flow test run ID to display test results for an enqueued or completed asynchronous test run. The test run ID is displayed after running the "sf flow run test" command.

To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level summary of the test run and the code coverage values for flow tests in your org. If you specify human-readable result format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

# examples

- Display flow test results for your default org using a test run ID:

  <%= config.bin %> <%= command.id %> --test-run-id <test run id>

- Similar to previous example, but output the result in JUnit format:

  <%= config.bin %> <%= command.id %> --test-run-id <test run id> --result-format junit

- Also retrieve code coverage results and output in JSON format:

  <%= config.bin %> <%= command.id %> --test-run-id <test run id> --code-coverage --json

- Specify a directory in which to save the test results from the org with the “me@my.org” username (rather than your default org):

  <%= config.bin %> <%= command.id %> --test-run-id <test run id> --code-coverage --output-dir <path to outputdir> --target-org me@my.org'

# apexLibErr

Unknown error in Apex Library: %s.

# noResultsFound

No results found.
