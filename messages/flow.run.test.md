# summary

Summary of a command.

# description

More information about a command. Don't repeat the summary.

# examples

- <%= config.bin %> <%= command.id %>

# flags.result-format.summary

Format of the test results.

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

# apexLibErr

Unknown error in Apex Library: %s

# flags.detailed-coverage.summary

Display detailed code coverage per test.

# flags.suite-names.summary

Apex test suite names to run.

# flags.suite-names.description

If you select --suite-names, you can't specify --class-names or --tests.
For multiple suites, repeat the flag for each.
--suite-names Suite1 --suite-names Suite2

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
