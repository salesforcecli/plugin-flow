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
