/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import fs from 'node:fs';
import { Messages, Org } from '@salesforce/core';
import sinon from 'sinon';
import { Ux, stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { assert, expect } from 'chai';
import { TestService } from '@salesforce/apex-node';
import FlowRunTest from '../../../../src/commands/flow/run/test.js';

import {
  runWithCoverage,
  runWithFailureAndSuccess,
  runWithFailures,
  testRunSimple,
  testRunSimpleResult,
  testRunWithFailuresResult,
} from '../../../testData.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'runtest');
const FLOW_CATEGORY = 'flow';

let logStub: sinon.SinonStub;
let styledJsonStub: sinon.SinonStub;

describe('flow:test:run', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    logStub = sandbox.stub(Ux.prototype, 'log');
    styledJsonStub = sandbox.stub(Ux.prototype, 'styledJSON');
    stubSfCommandUx(sandbox);
    sandbox.stub(Org, 'create').resolves({
      // @ts-expect-error: Should expect an error
      getConnection: () => ({
        getUsername: () => 'test@user.com',
        query: () => Promise.resolve({ records: ['flowtesting'] }),
      }),
    });
  });

  afterEach(() => {
    sandbox.restore();

    try {
      // the library writes to a directory, so we need to clean it up :(
      fs.rmSync('myDirectory', { recursive: true });
    } catch (e) {
      // do nothing
    }
  });

  describe('test failures', () => {
    it('should return a success human format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(runWithFailures);

      const result = await FlowRunTest.run([
        '--tests',
        'flowtesting.MyFlowTests.testConfig',
        '--result-format',
        'human',
      ]);
      expect(result).to.deep.equal(testRunWithFailuresResult);
      expect(logStub.firstCall.args[0]).to.include('=== Test Summary');
      expect(logStub.firstCall.args[0]).to.include('=== Test Results');
      expect(logStub.firstCall.args[0]).to.include('Test Run Id          707xx0000AUS2gH');
    });

    it('should return a success tap format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(runWithFailures);

      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests.testConfig', '--result-format', 'tap']);

      expect(result).to.deep.equal(testRunWithFailuresResult);
      expect(logStub.firstCall.args[0]).to.include('1..1');
      expect(logStub.firstCall.args[0]).to.include('# Run "sf flow get test -i 707');
    });

    it('should return a success junit format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(runWithFailures);
      const result = await FlowRunTest.run([
        '--tests',
        'flowtesting.MyFlowTests.testConfig',
        '--result-format',
        'junit',
      ]);
      expect(result).to.deep.equal(testRunWithFailuresResult);
      expect(logStub.firstCall.args[0]).to.include('<property name="failRate" value="50%"/>');
      expect(logStub.firstCall.args[0]).to.include('<property name="outcome" value="Failed"/>');
      expect(logStub.firstCall.args[0]).to.include('<failure message=""><![CDATA[Error running test]]></failure>');
    });

    it('should return a success json format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(runWithFailures);
      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--result-format', 'json']);
      expect(result).to.deep.equal(testRunWithFailuresResult);
      expect(styledJsonStub.firstCall.args[0]).to.deep.equal({ result: testRunWithFailuresResult, status: 100 });
    });

    it('should return a success --json format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves({ testRunId: '707xx0000AUS2gH' });
      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--json']);
      expect(result).to.deep.equal({ testRunId: '707xx0000AUS2gH' });
      expect(styledJsonStub.callCount).to.equal(0);
    });

    it('should return a success --json format message with sync', async () => {
      sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(runWithFailures);

      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--json', '--synchronous']);
      expect(result).to.deep.equal(testRunWithFailuresResult);
      expect(styledJsonStub.callCount).to.equal(0);
    });

    it('should return a success human format with synchronous', async () => {
      sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(runWithFailures);
      await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--result-format', 'human', '--synchronous']);
      expect(logStub.firstCall.args[0]).to.contain('Test Summary');
      expect(logStub.firstCall.args[0]).to.contain('Test Results');
      expect(logStub.firstCall.args[0]).to.not.contain('Code Coverage by Class');
    });

    it('should only display failed test with human format with concise flag', async () => {
      sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(runWithFailureAndSuccess);
      await FlowRunTest.run([
        '--tests',
        'flowtesting.MyFlowTests',
        '--result-format',
        'human',
        '--synchronous',
        '--concise',
      ]);
      expect(logStub.firstCall.args[0]).to.contain('Test Summary');
      expect(logStub.firstCall.args[0]).to.contain('Test Results');
      expect(logStub.firstCall.args[0]).to.contain('MyFailingTest');
      expect(logStub.firstCall.args[0]).to.not.contain('MyPassingTest');
      expect(logStub.firstCall.args[0]).to.not.contain('Code Coverage by Class');
    });

    it('will build the sync correct payload', async () => {
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildSyncPayload');
      const runTestSynchronousSpy = sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(runWithFailures);
      await FlowRunTest.run([
        '--class-names',
        'flowtesting.myFlow',
        '--synchronous',
        '--code-coverage',
        '--result-format',
        'human',
        '--test-level',
        'RunSpecifiedTests',
      ]);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal(['RunSpecifiedTests', undefined, 'flowtesting.myFlow']);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: false,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });

    it('will build the async correct payload', async () => {
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildAsyncPayload');
      const runTestSynchronousSpy = sandbox
        .stub(TestService.prototype, 'runTestAsynchronous')
        .resolves(runWithCoverage);
      await FlowRunTest.run([
        '--class-names',
        'flowtesting.myFlow',
        '--code-coverage',
        '--result-format',
        'human',
        '--test-level',
        'RunSpecifiedTests',
      ]);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal([
        'RunSpecifiedTests',
        undefined,
        'flowtesting.myFlow',
        undefined,
        FLOW_CATEGORY,
      ]);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: false,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });

    it('will build the async correct payload no code coverage', async () => {
      sandbox.stub(Org.prototype, 'getUsername').resolves('test@example.com');
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildAsyncPayload');
      const runTestSynchronousSpy = sandbox
        .stub(TestService.prototype, 'runTestAsynchronous')
        .resolves(runWithFailures);
      await FlowRunTest.run(['--class-names', 'flowtesting.myFlow', '--test-level', 'RunSpecifiedTests']);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal([
        'RunSpecifiedTests',
        undefined,
        'flowtesting.myFlow',
        undefined,
        FLOW_CATEGORY,
      ]);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });

    it('will build the sync correct payload no code coverage', async () => {
      sandbox.stub(Org.prototype, 'getUsername').resolves('test@example.com');
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildSyncPayload');
      const runTestSynchronousSpy = sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(runWithFailures);
      await FlowRunTest.run([
        '--class-names',
        'flowtesting.myFlow',
        '--synchronous',
        '--test-level',
        'RunSpecifiedTests',
      ]);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal(['RunSpecifiedTests', undefined, 'flowtesting.myFlow']);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });
  });

  describe('test success', () => {
    it('should return a success human format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      const result = await FlowRunTest.run([
        '--tests',
        'flowtesting.MyFlowTests.testConfig',
        '--result-format',
        'human',
      ]);

      expect(result).to.deep.equal(testRunSimpleResult);
      expect(logStub.firstCall.args[0]).to.include('=== Test Summary');
      expect(logStub.firstCall.args[0]).to.include('=== Test Results');
      expect(logStub.firstCall.args[0]).to.include('Test Run Id          707xx0000AUS2gH');
      expect(logStub.firstCall.args[0]).to.include('MyFlowTests.testConfig  Pass              53');
    });

    it('should parse tests flags correctly comma separated', async () => {
      const flowStub = sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      await FlowRunTest.run([
        '--tests',
        'flowtesting.MyFlowTests.test1,flowtesting.MyFlowTests.test2',
        '--result-format',
        'human',
      ]);
      expect(flowStub.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'MyFlowTests',
            namespace: 'flowtesting',
            testMethods: ['test1', 'test2'],
          },
        ],
      });
    });

    it('should parse tests flags correctly multi-flag', async () => {
      const flowStub = sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      await FlowRunTest.run([
        '--tests',
        'flowtesting.MyFlowTests.test1',
        '--tests',
        'flowtesting.MyFlowTests.test2',
        '--result-format',
        'human',
      ]);
      expect(flowStub.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'MyFlowTests',
            namespace: 'flowtesting',
            testMethods: ['test1', 'test2'],
          },
        ],
      });
    });

    it('should parse class-names flags correctly comma separated', async () => {
      const flowStub = sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      await FlowRunTest.run([
        '--class-names',
        'flowtesting.MyFirstTests,flowtesting.MySecondTest',
        '--result-format',
        'human',
      ]);
      expect(flowStub.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.MyFirstTests',
          },
          {
            className: 'flowtesting.MySecondTest',
          },
        ],
      });
    });

    it('should parse class-names (-n) flags correctly multi-flag', async () => {
      const flowStub = sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      await FlowRunTest.run([
        '-n',
        'flowtesting.MyFirstTests',
        '-n',
        'flowtesting.MySecondTest',
        '--result-format',
        'human',
      ]);
      expect(flowStub.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.MyFirstTests',
          },
          {
            className: 'flowtesting.MySecondTest',
          },
        ],
      });
    });

    it('should parse suite-names flags correctly comma separated', async () => {
      const flowStub = sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      await FlowRunTest.run([
        '--suite-names',
        'flowtesting.MyFlowTest1,flowtesting.MyFlowTest2',
        '--result-format',
        'human',
      ]);
      expect(flowStub.firstCall.args[0]).to.deep.equal({
        category: FLOW_CATEGORY,
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        suiteNames: 'flowtesting.MyFlowTest1,flowtesting.MyFlowTest2',
      });
    });

    it('should parse suite-names (-s) flags correctly multi-flag', async () => {
      const flowStub = sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      await FlowRunTest.run([
        '-s',
        'flowtesting.MyFlowTest1',
        '-s',
        'flowtesting.MyFlowTest2',
        '--result-format',
        'human',
      ]);
      expect(flowStub.firstCall.args[0]).to.deep.equal({
        category: FLOW_CATEGORY,
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        suiteNames: 'flowtesting.MyFlowTest1,flowtesting.MyFlowTest2',
      });
    });

    it('should return a success tap format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);

      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests.testConfig', '--result-format', 'tap']);

      expect(result).to.deep.equal(testRunSimpleResult);
      expect(logStub.firstCall.args[0]).to.include('1..1');
      expect(logStub.firstCall.args[0]).to.include('ok 1 MyFlowTests.testConfig');
      expect(logStub.firstCall.args[0]).to.include('# Run "sf flow get test -i 707');
    });

    it('should return a success junit format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);
      const result = await FlowRunTest.run([
        '--tests',
        'flowtesting.MyFlowTests.testConfig',
        '--result-format',
        'junit',
      ]);
      expect(result).to.deep.equal(testRunSimpleResult);
      expect(logStub.firstCall.args[0]).to.contain('<testcase name="testConfig" classname="MyFlowTests" time="0.05">');
      expect(logStub.firstCall.args[0]).to.contain('<property name="testsRan" value="1"/>');
    });

    it('should return a success json format message with async', async () => {
      process.exitCode = 0;
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);
      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--result-format', 'json']);
      expect(result).to.deep.equal(testRunSimpleResult);
      expect(styledJsonStub.firstCall.args[0]).to.deep.equal({ result: testRunSimpleResult, status: 0 });
    });

    it('should return a success --json format message with async', async () => {
      sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves({ testRunId: '707xx0000AUS2gH' });
      sandbox.stub(Org.prototype, 'getUsername').returns('test@user.com');
      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--json']);
      expect(result).to.deep.equal({ testRunId: '707xx0000AUS2gH' });
      expect(styledJsonStub.notCalled).to.be.true;
    });

    it('should return a success --json format message with sync', async () => {
      sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(testRunSimple);

      const result = await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--json', '--synchronous']);
      expect(result).to.deep.equal(testRunSimpleResult);
      expect(styledJsonStub.notCalled).to.be.true;
    });

    it('should return a success human format with synchronous', async () => {
      sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(testRunSimple);
      await FlowRunTest.run(['--tests', 'flowtesting.MyFlowTests', '--result-format', 'human', '--synchronous']);
      expect(logStub.firstCall.args[0]).to.contain('Test Summary');
      expect(logStub.firstCall.args[0]).to.contain('Test Results');
      expect(logStub.firstCall.args[0]).to.not.contain('Code Coverage by Class');
    });

    it('will build the sync correct payload', async () => {
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildSyncPayload');
      const runTestSynchronousSpy = sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(runWithCoverage);
      await FlowRunTest.run([
        '--class-names',
        'flowtesting.myFlow',
        '--synchronous',
        '--code-coverage',
        '--result-format',
        'human',
        '--test-level',
        'RunSpecifiedTests',
      ]);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal(['RunSpecifiedTests', undefined, 'flowtesting.myFlow']);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: false,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });

    it('will build the async correct payload', async () => {
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildAsyncPayload');
      const runTestSynchronousSpy = sandbox
        .stub(TestService.prototype, 'runTestAsynchronous')
        .resolves(runWithCoverage);
      await FlowRunTest.run([
        '--class-names',
        'flowtesting.myFlow',
        '--code-coverage',
        '--result-format',
        'human',
        '--test-level',
        'RunSpecifiedTests',
      ]);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal([
        'RunSpecifiedTests',
        undefined,
        'flowtesting.myFlow',
        undefined,
        FLOW_CATEGORY,
      ]);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: false,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });

    it('will build the async correct payload no code coverage', async () => {
      sandbox.stub(Org.prototype, 'getUsername').resolves('test@example.com');
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildAsyncPayload');
      const runTestSynchronousSpy = sandbox.stub(TestService.prototype, 'runTestAsynchronous').resolves(testRunSimple);
      await FlowRunTest.run(['--class-names', 'flowtesting.myFlow', '--test-level', 'RunSpecifiedTests']);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal([
        'RunSpecifiedTests',
        undefined,
        'flowtesting.myFlow',
        undefined,
        FLOW_CATEGORY,
      ]);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });

    it('will build the sync correct payload no code coverage', async () => {
      sandbox.stub(Org.prototype, 'getUsername').resolves('test@example.com');
      const buildPayloadSpy = sandbox.spy(TestService.prototype, 'buildSyncPayload');
      const runTestSynchronousSpy = sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(testRunSimple);
      await FlowRunTest.run([
        '--class-names',
        'flowtesting.myFlow',
        '--synchronous',
        '--test-level',
        'RunSpecifiedTests',
      ]);
      expect(buildPayloadSpy.calledOnce).to.be.true;
      expect(runTestSynchronousSpy.calledOnce).to.be.true;
      expect(buildPayloadSpy.firstCall.args).to.deep.equal(['RunSpecifiedTests', undefined, 'flowtesting.myFlow']);
      expect(runTestSynchronousSpy.firstCall.args[0]).to.deep.equal({
        skipCodeCoverage: true,
        testLevel: 'RunSpecifiedTests',
        tests: [
          {
            className: 'flowtesting.myFlow',
          },
        ],
      });
    });

    it('should only display summary with human format and code coverage and concise parameters', async () => {
      sandbox.stub(TestService.prototype, 'runTestSynchronous').resolves(runWithCoverage);
      await FlowRunTest.run([
        '--tests',
        'MyFlowTests',
        '--result-format',
        'human',
        '--synchronous',
        '--code-coverage',
        '--concise',
      ]);
      expect(logStub.firstCall.args[0]).to.contain('Test Summary');
      expect(logStub.firstCall.args[0]).to.not.contain('Test Results');
      expect(logStub.firstCall.args[0]).to.not.contain('Code Coverage by Class');
    });
  });

  describe('validateFlags', () => {
    it('rejects tests/classnames/suitenames and testlevels', async () => {
      try {
        await FlowRunTest.run(['--tests', 'flowtesting.mytest', '--test-level', 'RunAllTestsInOrg']);
      } catch (e) {
        expect((e as Error).message).to.equal(messages.getMessage('testLevelErr'));
      }
      try {
        await FlowRunTest.run(['--class-names', 'flowtesting.mytest', '--test-level', 'RunAllTestsInOrg']);
      } catch (e) {
        expect((e as Error).message).to.equal(messages.getMessage('testLevelErr'));
      }
      try {
        await FlowRunTest.run(['--suite-names', 'flowtesting.mytest', '--test-level', 'RunAllTestsInOrg']);
      } catch (e) {
        expect((e as Error).message).to.equal(messages.getMessage('testLevelErr'));
      }
    });

    it('rejects classname/suitnames/test variations', async () => {
      // uses oclif exclusive now
      try {
        await FlowRunTest.run(['--class-names', 'flowtesting.myFlow', '--suite-names', 'testsuite']);
      } catch (e) {
        assert(e instanceof Error);
        expect(e.message).to.include('cannot also be provided when using');
      }

      try {
        await FlowRunTest.run(['--class-names', 'flowtesting.myFlow', '--tests', 'testsuite']);
      } catch (e) {
        assert(e instanceof Error);
        expect(e.message).to.include('cannot also be provided when using');
      }

      try {
        await FlowRunTest.run(['--suite-names', 'myFlow', '--tests', 'testsuite']);
      } catch (e) {
        assert(e instanceof Error);
        expect(e.message).to.include('cannot also be provided when using');
      }
    });
  });
});
