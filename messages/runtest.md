# summary

Invoke Flow tests in an org.

# description

Specify which tests to run by using the --class-names, --suite-names, or --tests flags. Alternatively, use the --test-level flag to run all the tests in your org, local tests, or specified tests.

To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level summary of the test run and the code coverage values for classes in your org. If you specify human-readable result format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

By default, Flow tests run asynchronously and immediately return a test run ID. You can use the --wait flag to specify the number of minutes to wait; if the tests finish in that timeframe, the command displays the results. If the tests haven't finished by the end of the wait time, the command displays a test run ID. Use the "<%= config.bin %> flow get test --test-run-id" command to get the results.

You must have the "View All Data" system permission to use this command. The permission is disabled by default and can be enabled only by a system administrator.

NOTE: The testRunCoverage value (JSON and JUnit result formats) is a percentage of the covered lines and total lines from all the Flow classes evaluated by the tests in this run.

# examples

- Run all Flow tests and suites in your default org:

  <%= config.bin %> <%= command.id %>

- Run the specified Flow test classes in your default org and display results in human-readable form:

  <%= config.bin %> <%= command.id %> --class-names MyClassTest --class-names MyOtherClassTest --result-format human

- Run the specified Flow test suites in your default org and include code coverage results and additional details:

  <%= config.bin %> <%= command.id %> --suite-names MySuite --suite-names MyOtherSuite --code-coverage --detailed-coverage

- Run the specified Flow tests in your default org and display results in human-readable output:

  <%= config.bin %> <%= command.id %> --tests MyClassTest.testCoolFeature --tests MyClassTest.testAwesomeFeature --tests AnotherClassTest --tests namespace.TheirClassTest.testThis --result-format human

- Run all tests in the org with the specified username with the specified test level; save the output to the specified directory:

  <%= config.bin %> <%= command.id %> --test-level RunLocalTests --output-dir <path to outputdir> --target-org me@my.org

- Run all tests in the org asynchronously:

  <%= config.bin %> <%= command.id %> --target-org myscratch

- Run all tests synchronously; the command waits to display the test results until all tests finish:

  <%= config.bin %> <%= command.id %> --synchronous

- Run specific tests using the --test-level flag:

  <%= config.bin %> <%= command.id %> --test-level RunLocalTests

- Run Flow tests on all the methods in the specified class; output results in Test Anything Protocol (TAP) format and request code coverage results:

  <%= config.bin %> <%= command.id %> --class-names TestA --class-names TestB --result-format tap --code-coverage

- Run Flow tests on methods specified using the standard Class.method notation; if you specify a test class without a method, the command runs all methods in the class:

  <%= config.bin %> <%= command.id %> --tests TestA.excitingMethod --tests TestA.boringMethod --tests TestB

- Run Flow tests on methods specified using the standard Class.method notation with a namespace:

  <%= config.bin %> <%= command.id %> --tests ns.TestA.excitingMethod --tests ns.TestA.boringMethod --tests ns.TestB

# flags.class-names.summary

Flow test class names to run; default is all classes.

# flags.class-names.description

If you select --class-names, you can't specify --suite-names or --tests.
For multiple classes, repeat the flag for each.
--class-names Class1 --class-names Class2

# flags.suite-names.summary

Flow test suite names to run.

# flags.suite-names.description

If you select --suite-names, you can't specify --class-names or --tests.
For multiple suites, repeat the flag for each.
--suite-names Suite1 --suite-names Suite2

# flags.tests.summary

Flow test class names or IDs and, if applicable, test methods to run; default is all tests.

# flags.tests.description

If you specify --tests, you can't specify --class-names or --suite-names
For multiple tests, repeat the flag for each.
--tests Test1 --tests Test2

# flags.wait.summary

Sets the streaming client socket timeout in minutes; specify a longer wait time if timeouts occur frequently.

# flags.detailed-coverage.summary

Display detailed code coverage per test.

# syncClassErr

Synchronous test runs can include test methods from only one Flow class. Omit the --synchronous flag or include tests from only one class

# testLevelErr

When specifying flows or tests, indicate RunSpecifiedTests as the testlevel.

# testResultProcessErr

Encountered an error when processing test results
%s

# apexTestReportFormatHint

Run "sf flow get test %s --result-format <format>" to retrieve test results in a different format.

# outputDirHint

Test result files written to %s

# apexLibErr

Unknown error in Apex Library: %s

# syncClassErr

Synchronous test runs can include test methods from only one Flow class. Omit the --synchronous flag or include tests from only one class
