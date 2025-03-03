import { CancellationTokenSource, TestLevel, TestResult, TestService, TestRunIdResult } from '@salesforce/flows';
import { SfCommand, Flags, loglevel, arrayWithDeprecation, Ux,} from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { RunResult, TestReporter} from '../../../reporters/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url)
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.run.test');
export const TestLevelValues = ['RunLocalTests', 'RunAllTestsInOrg', 'RunSpecifiedTests'];

// xport type FlowRunTestResult = Array<{ Name: string; Id: string }>;
export type FlowRunTestResult = RunResult | TestRunIdResult;
const exclusiveTestSpecifiers = ['class-names', 'suite-names', 'tests'];


export default class FlowRunTest extends SfCommand<FlowRunTestResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    loglevel ,
    'result-format': Flags.string({
      deprecateAliases: true,
      aliases: ['resultformat'],
      char: 'r',
      summary: messages.getMessage('flags.result-format.summary'),
      options: ['human', 'tap', 'junit', 'json'] as const,
      default: 'human'
    }),
    'concise': Flags.boolean({
      summary: messages.getMessage('flags.concise.summary'),
    }),
    'output-dir': Flags.directory({
      aliases: ['outputdir', 'output-directory'],
      deprecateAliases: true,
      char: 'd',
      summary: messages.getMessage('flags.output-dir.summary'),
    }),
    'class-names': arrayWithDeprecation({
      deprecateAliases: true,
      aliases: ['classnames'],
      char: 'n',
      summary: messages.getMessage('flags.class-names.summary'),
      description: messages.getMessage('flags.class-names.description'),
      exclusive: exclusiveTestSpecifiers.filter((specifier) => specifier !== 'class-names'),
    }),
    'code-coverage': Flags.boolean({
      aliases: ['codecoverage'],
      deprecateAliases: true,
      char: 'c',
      summary: messages.getMessage('flags.code-coverage.summary'),
    }),
    'test-level': Flags.string({
      deprecateAliases: true,
      aliases: ['testlevel'],
      char: 'l',
      summary: messages.getMessage('flags.test-level.summary'),
      description: messages.getMessage('flags.test-level.description'),
      options: TestLevelValues,
    }),
    'suite-names': arrayWithDeprecation({
      deprecateAliases: true,
      aliases: ['suitenames'],
      char: 's',
      summary: messages.getMessage('flags.suite-names.summary'),
      description: messages.getMessage('flags.suite-names.description'),
      exclusive: exclusiveTestSpecifiers.filter((specifier) => specifier !== 'suite-names'),
    }),
    tests: arrayWithDeprecation({
      char: 't',
      summary: messages.getMessage('flags.tests.summary'),
      description: messages.getMessage('flags.tests.description'),
      exclusive: exclusiveTestSpecifiers.filter((specifier) => specifier !== 'tests'),
    }),
    synchronous: Flags.boolean({
      char: 'y',
      summary: messages.getMessage('flags.synchronous.summary'),
    }),
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
      // Log the proper 'apex get test' command for the user to run later
      this.log(messages.getMessage('runTestReportCommand', [this.config.bin, result.testRunId, conn.getUsername()]));
      this.info(messages.getMessage('runTestSyncInstructions'));

      if (flags['output-dir']) {
        // testService writes a file with just the test run id in it to test-run-id.txt
        // github.com/forcedotcom/salesforcedx-apex/blob/c986abfabee3edf12f396f1d2e43720988fa3911/src/tests/testService.ts#L245-L246
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
