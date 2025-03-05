# Salesforce Flow Test Plugin

![npm (scoped)](https://img.shields.io/npm/v/@salesforce/plugin-flow)
[![License](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)
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

- [`sf flow get log`](#sf-apex-get-log)
- [`sf flow get test`](#sf-apex-get-test)
- [`sf flow list log`](#sf-apex-list-log)
- [`sf flow run`](#sf-apex-run)
- [`sf flow run test`](#sf-apex-run-test)
- [`sf flow tail log`](#sf-apex-tail-log)
