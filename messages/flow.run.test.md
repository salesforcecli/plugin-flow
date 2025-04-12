# summary

Invoke flow tests in an org.

# description

Specify which tests to run by using the --class-names flag followed by the names of the flows you want to test. For example, if you save a flow with the name Flow1, then use: --class-names Flow1.

To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level summary of the test run and the code coverage values for classes in your org. If you specify human-readable result format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

By default, "flow run test" runs asynchronously and immediately returns a test run ID. If you use the -–synchronous flag, you can use the --wait flag to specify the number of minutes to wait; if the tests finish in that timeframe, the command displays the results. If the tests haven't finished by the end of the wait time, the command displays a test run ID. Use the "flow get test --test-run-id" command to get the results.
You must have the "View All Data" org system permission to use this command. The permission is disabled by default and can be enabled only by a system administrator.

# examples

- Run all local tests in your default org:
  <%= config.bin %> <%= command.id %> --test-level RunLocalTests

- Run all the Flow1 and Flow2 flow tests in the org with alias “scratchOrg”:
  <%= config.bin %> <%= command.id %> —target-org scratchOrg —class-names Flow1 --class-names Flow2

- Run specific Flow1 and Flow2 flow tests in your default org:
  <%= config.bin %> <%= command.id %> --tests Flow1.Test1 --tests Flow2.Test2 --test-level RunSpecifiedTests

- Run all tests synchronously in your default org; the command waits to display the test results until all tests finish:
  <%= config.bin %> <%= command.id %> –synchronous

- Run all local tests in the org with the username “me@my.org”; save the output to the specified directory:
  <%= config.bin %> <%= command.id %> --test-level RunLocalTests --output-dir /Users/susan/temp/cliOutput --target-org me@my.org

# apexLibErr

Unknown error in Apex Library: %s.

# runTestReportCommand

Run "%s flow get test -i %s -o %s" to retrieve test results.

# runTestSyncInstructions

Run with --synchronous or increase --wait timeout to wait for results.

# syncClassErr

Synchronous test runs can include tests from only one Flow. Omit the --synchronous flag or include tests from only one flow.

# testLevelErr

When specifying flows or tests, indicate RunSpecifiedTests as the testlevel.
