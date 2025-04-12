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
```

Alternatively, you can also run the command from the `plugin-flow` package directory without linking the plugin:

```
$ NODE_OPTIONS=--inspect-brk bin/dev force:flow:run:test -u myOrg@example.com
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
$ sfdx force:flow:run:test -u myOrg@example.com --dev-suspend
```

Alternatively, replace `sfdx` with `NODE_OPTIONS=--inspect-brk bin/dev` and run your command:

```
$ NODE_OPTIONS=--inspect-brk bin/dev force:flow:run:test -u myOrg@example.com
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

- [`sf flow get test`](#sf-flow-get-test)
- [`sf flow run test`](#sf-flow-run-test)

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
      --detailed-coverage       Not available for flow tests.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Display test results for a specific asynchronous test run.

  Provide a flow test run ID to display test results for an enqueued or completed asynchronous test run. The test run ID
  is displayed after running the "sf flow run test" command.

  To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level
  summary of the test run and the code coverage values for flow tests in your org. If you specify human-readable result
  format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

ALIASES
  $ sf force flow test report

EXAMPLES
  Display flow test results for your default org using a test run ID:

    $ sf flow get test --test-run-id <test run id>

  Similar to previous example, but output the result in JUnit format:

    $ sf flow get test --test-run-id <test run id> --result-format junit

  Also retrieve code coverage results and output in JSON format:

    $ sf flow get test --test-run-id <test run id> --code-coverage --json

  Specify a directory in which to save the test results from the org with the “me@my.org” username (rather than your
  default org):

    $ sf flow get test --test-run-id <test run id> --code-coverage --output-dir <path to outputdir> --target-org \
      me@my.org'
```

## `sf flow run test`

Invoke flow tests in an org.

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
  -n, --class-names=<value>...  Flow names that contain flow tests to run.
  -o, --target-org=<value>      (required) Username or alias of the target org. Not required if the `target-org`
                                configuration variable is already set.
  -r, --result-format=<option>  [default: human] Format of the test results.
                                <options: human|tap|junit|json>
  -s, --suite-names=<value>...  Not available for flow tests.
  -t, --tests=<value>...        Flow test names to run.
  -y, --synchronous             Run flow tests for one flow synchronously; if not specified, tests are run
                                asynchronously.
      --api-version=<value>     Override the api version used for api requests made by this command
      --concise                 Display only failed test results; works with human-readable output only.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Invoke flow tests in an org.

  Specify which tests to run by using the --class-names flag followed by the names of the flows you want to test. For
  example, if you save a flow with the name Flow1, then use: –class-names Flow1.

  To see code coverage results, use the --code-coverage flag with --result-format. The output displays a high-level
  summary of the test run and the code coverage values for classes in your org. If you specify human-readable result
  format, use the --detailed-coverage flag to see detailed coverage results for each test method run.

  By default, flow run test runs asynchronously and immediately returns a test run ID. If you use the –synchronous flag,
  you can use the --wait flag to specify the number of minutes to wait; if the tests finish in that timeframe, the
  command displays the results. If the tests haven't finished by the end of the wait time, the command displays a test
  run ID. Use the "sf flow get test --test-run-id" command to get the results.

  You must have the "View All Data" org system permission to use this command. The permission is disabled by default and
  can be enabled only by a system administrator.

ALIASES
  $ sf force flow test run

EXAMPLES
  Run all local tests in your default org:

    $ sf flow run test --test-level RunLocalTests

  Run all the Flow1 and Flow2 flow tests in the org with alias “scratchOrg”:

    $ sf flow run test —target-org scratchOrg —class-names Flow1 --class-names Flow2

  Run specific Flow1 and Flow2 flow tests in your default org:

    $ sf flow run test --tests Flow1.Test1 --tests Flow2.Test2

  Run all tests synchronously in your default org; the command waits to display the test results until all tests
  finish:

    $ sf flow run test –synchronous

  Run all local tests in the org with the username “me@my.org”; save the output to the specified directory:

    $ sf flow run test --test-level RunLocalTests --output-dir /Users/susan/temp/cliOutput --target-org me@my.org

FLAG DESCRIPTIONS
  -l, --test-level=RunLocalTests|RunAllTestsInOrg|RunSpecifiedTests  Level of tests to run; default is RunLocalTests.

    Here's what the levels mean:

    - RunLocalTests — All tests in your org are run, except the ones that originate from installed managed and unlocked
    packages.
    - RunAllTestsInOrg — All tests are run. The tests include all tests in your org, including tests of managed
    packages.

  -n, --class-names=<value>...  Flow names that contain flow tests to run.

    Default is all flow tests. If you select --class-names, you can't specify --tests.

  -s, --suite-names=<value>...  Not available for flow tests.

    Not available for flow tests.

  -t, --tests=<value>...  Flow test class names or IDs and, if applicable, test methods to run; default is all tests.

    If you specify --tests, you can't specify --class-names or --suite-names
    For multiple tests, repeat the flag for each.
    --tests Test1 --tests Test2
```

<!-- commandsstop -->

- [`sf flow get test`](#sf-flow-get-test)
- [`sf flow run`](#sf-flow-run)
- [`sf flow run test`](#sf-flow-run-test)
