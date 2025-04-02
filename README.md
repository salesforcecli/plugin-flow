# Salesforce Flow Test Plugin

![npm (scoped)](https://img.shields.io/npm/v/@salesforce/plugin-flow)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/license/apache-2-0)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)

## Introduction

This is an oclif plugin that supports the Salesforce Flow Test commands.

### Building the Plugin

Clone the project and `cd` into it:

```
$ git clone git@github.com:salesforcecli/plugin-flow.git
$ cd plugin-flow
```

Ensure you have [Yarn](https://yarnpkg.com/) installed, then run:

```
$ yarn install
$ yarn build
```

<br />

### Linking the Plugin

Link the plugin from the `plugin-flow` package directory and then run your command:

```
$ sfdx plugins:link .
$ sfdx force:flow:log:list -u myOrg@example.com
```

Alternatively, you can also run the command from the `plugin-flow` package directory without linking the plugin:

```
$ NODE_OPTIONS=--inspect-brk bin/dev force:flow:log:list -u myOrg@example.com
```

<br />

### Running the Test Suite

Test the test suite locally by building the project first and then running the tests.

```
$ yarn build
$ yarn test
```

<br />

### Debugging the Plugin

We recommend using the Visual Studio Code (VS Code) IDE for your plugin development. Included in the `.vscode` directory of this plugin is a `launch.json` config file, which allows you to attach a debugger to the node process when running your commands. To debug a command:

1. If you linked your plugin to the Salesforce CLI using `yarn plugin:link`, call your command with the `dev-suspend` switch:

```
$ sfdx force:flow:log:list -u myOrg@example.com --dev-suspend
```

Alternatively, replace `sfdx` with `NODE_OPTIONS=--inspect-brk bin/dev` and run your command:

```
$ NODE_OPTIONS=--inspect-brk bin/dev force:apex:log:list -u myOrg@example.com
```

2. Set some breakpoints in your code.
3. Click on the Debug icon in the Activity Bar to open up the Debugger view.
4. In the upper left hand corner, set the launch configuration to `Attach to Remote`.
5. Click the green play button on the left of the debugger view. The debugger should now be suspended on the first line of the program.
6. Click the green play button in the mini toolbar to continue running the program.
   <br /><br />
   <img src="./.images/vscodeScreenshot.png" width="480" height="278">

<br />
Happy debugging!

<br /><br />

# Commands

<!-- commands -->
* [`sf flow get log`](#sf-flow-get-log)
* [`sf flow get test`](#sf-flow-get-test)
* [`sf flow run test`](#sf-flow-run-test)

## `sf flow get log`

Display test results for a specific asynchronous test run.

```
USAGE
  $ sf flow get log -o <value> [--json] [--flags-dir <value>] [--api-version <value>] [-i <value>] [-n <value>]
    [-d <value>]

FLAGS
  -d, --output-dir=<value>   Directory in which to store test result files.
  -i, --log-id=<value>       ID of the specific log to display.
  -n, --number=<value>       Number of the most recent logs to display.
  -o, --target-org=<value>   (required) Username or alias of the target org. Not required if the `target-org`
                             configuration variable is already set.
      --api-version=<value>  Override the api version used for api requests made by this command

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Display test results for a specific asynchronous test run.

  Provide a test run ID to display test results for an enqueued or completed asynchronous test run. The test run ID is
  displayed after running the "sf apex test run" command.

  To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level
  summary of the test run and the code coverage values for classes in your org. If you specify human-readable result
  format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

ALIASES
  $ sf force apex log get

EXAMPLES
  Display test results for your default org using a test run ID:

    $ sf flow get log --test-run-id <test run id>

  Similar to previous example, but output the result in JUnit format:

    $ sf flow get log --test-run-id <test run id> --result-format junit

  Also retrieve code coverage results and output in JSON format:

    $ sf flow get log --test-run-id <test run id> --code-coverage --json

  Specify a directory in which to save the test results from the org with the specified username (rather than your
  default org):

    $ sf flow get log --test-run-id <test run id> --code-coverage --output-dir <path to outputdir> --target-org \
      me@myorg'
```

## `sf flow get test`

Display test results for a specific asynchronous test run.

```
USAGE
  $ sf flow get test -o <value> -i <value> [--json] [--flags-dir <value>] [--api-version <value>]
    [--detailed-coverage -c] [-d <value>] [-r human|tap|junit|json] [--concise]

FLAGS
  -c, --code-coverage           Retrieve code coverage results.
  -d, --output-dir=<value>      Directory in which to store test result files.
  -i, --test-run-id=<value>     (required) ID of the test run.
  -o, --target-org=<value>      (required) Username or alias of the target org. Not required if the `target-org`
                                configuration variable is already set.
  -r, --result-format=<option>  [default: human] Format of the test results.
                                <options: human|tap|junit|json>
      --api-version=<value>     Override the api version used for api requests made by this command
      --concise                 Display only failed test results; works with human-readable output only.
      --detailed-coverage       Display detailed code coverage per test.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Display test results for a specific asynchronous test run.

  Provide a test run ID to display test results for an enqueued or completed asynchronous test run. The test run ID is
  displayed after running the "sf apex test run" command.

  To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level
  summary of the test run and the code coverage values for classes in your org. If you specify human-readable result
  format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

ALIASES
  $ sf force flow test report

EXAMPLES
  Display test results for your default org using a test run ID:

    $ sf flow get test --test-run-id <test run id>

  Similar to previous example, but output the result in JUnit format:

    $ sf flow get test --test-run-id <test run id> --result-format junit

  Also retrieve code coverage results and output in JSON format:

    $ sf flow get test --test-run-id <test run id> --code-coverage --json

  Specify a directory in which to save the test results from the org with the specified username (rather than your
  default org):

    $ sf flow get test --test-run-id <test run id> --code-coverage --output-dir <path to outputdir> --target-org \
      me@myorg'
```

## `sf flow run test`

Summary of a command.

```
USAGE
  $ sf flow run test -o <value> [--json] [--flags-dir <value>] [--api-version <value>] [-r human|tap|junit|json]
    [--concise] [-d <value>] [-c] [-y] [-l RunLocalTests|RunAllTestsInOrg|RunSpecifiedTests] [-n <value>... | -s
    <value>... | -t <value>...]

FLAGS
  -c, --code-coverage           Retrieve code coverage results.
  -d, --output-dir=<value>      Directory in which to store test result files.
  -l, --test-level=<option>     Level of tests to run; default is RunLocalTests.
                                <options: RunLocalTests|RunAllTestsInOrg|RunSpecifiedTests>
  -n, --class-names=<value>...  Flow test class names to run; default is all classes.
  -o, --target-org=<value>      (required) Username or alias of the target org. Not required if the `target-org`
                                configuration variable is already set.
  -r, --result-format=<option>  [default: human] Format of the test results.
                                <options: human|tap|junit|json>
  -s, --suite-names=<value>...  Flow test suite names to run.
  -t, --tests=<value>...        Flow test class names or IDs and, if applicable, test methods to run; default is all
                                tests.
  -y, --synchronous             Runs test methods from a single Apex class synchronously; if not specified, tests are
                                run asynchronously.
      --api-version=<value>     Override the api version used for api requests made by this command
      --concise                 Display only failed test results; works with human-readable output only.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Summary of a command.

  More information about a command. Don't repeat the summary.

ALIASES
  $ sf force flow test run

EXAMPLES
  $ sf flow run test

FLAG DESCRIPTIONS
  -l, --test-level=RunLocalTests|RunAllTestsInOrg|RunSpecifiedTests  Level of tests to run; default is RunLocalTests.

    Here's what the levels mean:

    - RunSpecifiedTests — Only the tests that you specify in the runTests option are run. Code coverage requirements
    differ from the default coverage requirements when using this test level. The executed tests must cover each class
    and trigger in the deployment package for a minimum of 75% code coverage. This coverage is computed for each class
    and triggers individually, and is different than the overall coverage percentage.
    - RunLocalTests — All local tests in your org, including tests that originate from no-namespaced unlocked packages,
    are run. The tests that originate from installed managed packages and namespaced unlocked packages aren't run. This
    test level is the default for production deployments that include Apex classes or triggers.
    - RunAllTestsInOrg — All tests are run. The tests include all tests in your org.

  -n, --class-names=<value>...  Flow test class names to run; default is all classes.

    If you select --class-names, you can't specify --suite-names or --tests.
    For multiple classes, repeat the flag for each.
    --class-names Class1 --class-names Class2

  -s, --suite-names=<value>...  Flow test suite names to run.

    If you select --suite-names, you can't specify --class-names or --tests.
    For multiple suites, repeat the flag for each.
    --suite-names Suite1 --suite-names Suite2

  -t, --tests=<value>...  Flow test class names or IDs and, if applicable, test methods to run; default is all tests.

    If you specify --tests, you can't specify --class-names or --suite-names
    For multiple tests, repeat the flag for each.
    --tests Test1 --tests Test2
```
<!-- commandsstop -->

- [`sf flow get log`](#sf-flow-get-log)
- [`sf flow get test`](#sf-flow-get-test)
- [`sf flow list log`](#sf-flow-list-log)
- [`sf flow run`](#sf-flow-run)
- [`sf flow run test`](#sf-flow-run-test)
- [`sf flow tail log`](#sf-flow-tail-log)
