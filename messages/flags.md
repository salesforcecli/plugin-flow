# flags.result-format.summary

Format of the test results.

# flags.code-coverage.summary

Retrieve code coverage results.

# flags.output-dir.summary

Directory in which to store test result files.

# flags.concise.summary

Display only failed test results; works with human-readable output only.

# flags.synchronous.summary

Runs test methods from a single Apex class synchronously; if not specified, tests are run asynchronously.

# flags.test-level.summary

Level of tests to run; default is RunLocalTests.

# flags.test-level.description

Here's what the levels mean:

- RunSpecifiedTests — Only the tests that you specify in the runTests option are run. Code coverage requirements differ from the default coverage requirements when using this test level. The executed tests must cover each class and trigger in the deployment package for a minimum of 75% code coverage. This coverage is computed for each class and triggers individually, and is different than the overall coverage percentage.
- RunLocalTests — All local tests in your org, including tests that originate from no-namespaced unlocked packages, are run. The tests that originate from installed managed packages and namespaced unlocked packages aren't run. This test level is the default for production deployments that include Apex classes or triggers.
- RunAllTestsInOrg — All tests are run. The tests include all tests in your org.

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

# flags.log-id.summary

ID of the specific log to display.

# flags.number.summary

Number of the most recent logs to display.

# flags.test-run-id.summary

ID of the test run.

# flags.detailed-coverage.summary

Display detailed code coverage per test.
