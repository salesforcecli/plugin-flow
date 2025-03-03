# summary

Summary of a command.

# description

More information about a command. Don't repeat the summary.

# examples

- <%= config.bin %> <%= command.id %>

# flags.result-format.summary

Format of the test results.

# flags.concise.summary

Display only failed test results; works with human-readable output only.

# flags.output-dir.summary

Directory in which to store test result files.

# flags.class-names.summary

Apex test class names to run; default is all classes.

# flags.class-names.description

If you select --class-names, you can't specify --suite-names or --tests.
For multiple classes, repeat the flag for each.
--class-names Class1 --class-names Class2

# flags.code-coverage.summary

Retrieve code coverage results.

# flags.test-run-id.summary

ID of the test run.

# flags.concise.summary

Display only failed test results; works with human-readable output only.

# apexLibErr

Unknown error in Apex Library: %s

# flags.detailed-coverage.summary

Display detailed code coverage per test.

# flags.test-level.summary

Level of tests to run; default is RunLocalTests.

# flags.test-level.description

Here's what the levels mean:

- RunSpecifiedTests — Only the tests that you specify in the runTests option are run. Code coverage requirements differ from the default coverage requirements when using this test level. The executed tests must cover each class and trigger in the deployment package for a minimum of 75% code coverage. This coverage is computed for each class and triggers individually, and is different than the overall coverage percentage.
- RunLocalTests — All local tests in your org, including tests that originate from no-namespaced unlocked packages, are run. The tests that originate from installed managed packages and namespaced unlocked packages aren't run. This test level is the default for production deployments that include Apex classes or triggers.
- RunAllTestsInOrg — All tests are run. The tests include all tests in your org.

# flags.suite-names.summary

Apex test suite names to run.

# flags.suite-names.description

If you select --suite-names, you can't specify --class-names or --tests.
For multiple suites, repeat the flag for each.
--suite-names Suite1 --suite-names Suite2

# flags.synchronous.summary

Runs test methods from a single Apex class synchronously; if not specified, tests are run asynchronously.

# runTestReportCommand

Run "%s flow get test -i %s -o %s" to retrieve test results

# runTestSyncInstructions

Run with --synchronous or increase --wait timeout to wait for results.

# syncClassErr

Synchronous test runs can include test methods from only one Apex class. Omit the --synchronous flag or include tests from only one class

# testLevelErr

When specifying classnames, suitenames, or tests, indicate RunSpecifiedTests as the testlevel

# flags.tests.summary

Apex test class names or IDs and, if applicable, test methods to run; default is all tests.

# flags.tests.description

If you specify --tests, you can't specify --class-names or --suite-names
For multiple tests, repeat the flag for each.
--tests Test1 --tests Test2
