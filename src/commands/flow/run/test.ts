import { CancellationTokenSource, TestLevel, TestResult, TestService, TestRunIdResult } from '@salesforce/apex-node';
import { SfCommand, Flags, Ux } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { RunResult, TestReporter } from '../../../reporters/index.js';
import {
  resultFormatFlag,
  codeCoverageFlag,
  outputDirectoryFlag,
  conciseFlag,
  synchronousFlag,
  testLevelFlag,
  classNamesFlag,
  suiteNamesFlag,
  testsFlag,
} from '../../../flags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.run.test');

export type FlowRunTestResult = RunResult | TestRunIdResult;

export default class FlowRunTest extends SfCommand<FlowRunTestResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly deprecateAliases = true;
  public static readonly aliases = ['force:flow:test:run'];

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'result-format': resultFormatFlag,
    concise: conciseFlag,
    'output-dir': outputDirectoryFlag,
    'code-coverage': codeCoverageFlag,
    synchronous: synchronousFlag,
    'test-level': testLevelFlag,
    'class-names': classNamesFlag,
    'suite-names': suiteNamesFlag,
    tests: testsFlag,
  };
  protected cancellationTokenSource = new CancellationTokenSource();

  public async run(): Promise<FlowRunTestResult> {
    // parse the provided flags
    const { flags } = await this.parse(FlowRunTest);

    const testLevel = await validateFlags(
      flags['class-names'],
      flags['suite-names'],
      flags.tests,
      flags.synchronous,
      flags['test-level'] as TestLevel
    );

    // graceful shutdown
    const exitHandler = async (): Promise<void> => {
      await this.cancellationTokenSource.asyncCancel();
      process.exit();
    };

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.on('SIGINT', exitHandler);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.on('SIGTERM', exitHandler);

    const conn = flags['target-org'].getConnection(flags['api-version']);
    const testService = new TestService(conn);

    const result =
      flags.synchronous && testLevel === TestLevel.RunSpecifiedTests
        ? await this.runTest(testService, flags, testLevel)
        : await this.runTestAsynchronous(testService, flags, testLevel);

    if (this.cancellationTokenSource.token.isCancellationRequested) {
      throw new SfError('Cancelled');
    }

    if ('summary' in result) {
      const testReporter = new TestReporter(new Ux({ jsonEnabled: this.jsonEnabled() }), conn);
      return testReporter.report(result, flags);
    } else {
      // Tests were ran asynchronously or the --wait timed out.
      // Log the proper 'flow get test' command for the user to run later
      this.log(messages.getMessage('runTestReportCommand', [this.config.bin, result.testRunId, conn.getUsername()]));
      this.info(messages.getMessage('runTestSyncInstructions'));

      if (flags['output-dir']) {
        // testService writes a file with just the test run id in it to test-run-id.txt
        await testService.writeResultFiles(result, { dirPath: flags['output-dir'] }, flags['code-coverage']);
      }

      return result;
    }
  }

  private async runTest(
    testService: TestService,
    flags: {
      tests?: string[];
      'class-names'?: string[];
      'code-coverage'?: boolean;
    },
    testLevel: TestLevel
  ): Promise<TestResult> {
    const payload = {
      ...(await testService.buildSyncPayload(testLevel, flags.tests?.join(','), flags['class-names']?.join(','))),
      skipCodeCoverage: !flags['code-coverage'],
    };
    return testService.runTestSynchronous(
      payload,
      flags['code-coverage'],
      this.cancellationTokenSource.token
    ) as Promise<TestResult>;
  }

  private async runTestAsynchronous(
    testService: TestService,
    flags: {
      tests?: string[];
      'class-names'?: string[];
      'suite-names'?: string[];
      'code-coverage'?: boolean;
      synchronous?: boolean;
      'result-format'?: string;
      json?: boolean;
      wait?: Duration;
    },
    testLevel: TestLevel
  ): Promise<TestRunIdResult> {
    const payload = {
      ...(await testService.buildAsyncPayload(
        testLevel,
        flags.tests?.join(','),
        flags['class-names']?.join(','),
        flags['suite-names']?.join(',')
      )),
      skipCodeCoverage: !flags['code-coverage'],
    };

    // cast as TestRunIdResult because we're building an async payload which will return an async result
    return (await testService.runTestAsynchronous(
      payload,
      flags['code-coverage'],
      flags.wait && flags.wait.minutes > 0 ? false : !(flags.synchronous && !this.jsonEnabled()),
      undefined,
      this.cancellationTokenSource.token,
      flags.wait
    )) as TestRunIdResult;
  }
}

const validateFlags = async (
  classNames?: string[],
  suiteNames?: string[],
  tests?: string[],
  synchronous?: boolean,
  testLevel?: TestLevel
): Promise<TestLevel> => {
  if (synchronous && (Boolean(suiteNames) || (classNames?.length && classNames.length > 1))) {
    return Promise.reject(new Error(messages.getMessage('syncClassErr')));
  }

  if (
    (Boolean(tests) || Boolean(classNames) || suiteNames) &&
    testLevel &&
    testLevel.toString() !== 'RunSpecifiedTests'
  ) {
    return Promise.reject(new Error(messages.getMessage('testLevelErr')));
  }

  if (testLevel) {
    return testLevel;
  }
  if (Boolean(classNames) || Boolean(suiteNames) || tests) {
    return TestLevel.RunSpecifiedTests;
  }
  return TestLevel.RunLocalTests;
};
