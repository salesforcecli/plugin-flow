/*
 * Copyright 2026, Salesforce, Inc.
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

import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { expect } from 'chai';
import sinon from 'sinon';
import { Org, SfError } from '@salesforce/core';
import {
  ConnectFlowVersionListClient,
  ConnectFlowVersionPruneJobClient,
  FlowVersionError,
  FlowVersionPruneJobRequestError,
  type FlowVersionPruneJobStatus,
} from '@salesforce/flow-node';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import FlowVersionJobReportCommand from '../../../../../src/commands/flow/version/job/report.js';
import { ConfirmationPrompt } from '../../../../../src/ux/confirmation.js';

const jobId = '08P000000000001';
const deletedId = '301000000000001';
const blockedId = '301000000000002AAA';
const statuses: FlowVersionPruneJobStatus[] = ['Scheduled', 'Running', 'Complete', 'Error'];
const validateReport = new Ajv({ allErrors: true }).compile(
  JSON.parse(
    readFileSync(new URL('../../../../../schemas/flow-version-job-report.json', import.meta.url), 'utf8')
  ) as object
);

describe('flow version job report command', () => {
  const sandbox = sinon.createSandbox();
  const args = ['--target-org', 'source', '--api-version', '69.0', '--job-id', jobId];
  let lookup: sinon.SinonStub;
  let submit: sinon.SinonStub;
  let list: sinon.SinonStub;
  let confirm: sinon.SinonStub;
  let getConnection: sinon.SinonStub;
  let request: sinon.SinonStub;
  let log: sinon.SinonStub;
  let logJson: sinon.SinonStub;
  let logToStderr: sinon.SinonStub;
  let username: string | undefined;
  let apiVersion: string;
  let originalExitCode: typeof process.exitCode;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const;
  let originalSignalListeners: Map<(typeof signals)[number], NodeJS.SignalsListener[]>;

  const setJob = (status: FlowVersionPruneJobStatus, result: string | null = null, error: string | null = null) => {
    lookup.resolves({ jobId, status, result: 'MASKED' });
    request.resolves({ Status: status, Result: result, Error: error });
  };

  const failure = async (commandArgs: string[]): Promise<Error & { exitCode?: number; data?: unknown }> => {
    let caught: unknown;
    try {
      await FlowVersionJobReportCommand.run(commandArgs);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    return caught as Error & { exitCode?: number; data?: unknown };
  };

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    originalSignalListeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
    username = 'job-report-unit@example.invalid';
    apiVersion = '69.0';
    ({ log, logJson, logToStderr } = stubSfCommandUx(sandbox));
    request = sandbox.stub().rejects(new Error('Unexpected BackgroundOperation read.'));
    getConnection = sandbox.stub().returns({ getApiVersion: () => apiVersion, request });
    sandbox.stub(Org, 'create').resolves({ getConnection, getUsername: () => username } as unknown as Org);
    lookup = sandbox
      .stub(ConnectFlowVersionPruneJobClient.prototype, 'getOperation')
      .resolves({ jobId, status: 'Scheduled' });
    lookup.onSecondCall().rejects(new Error('Job report must not poll or retry the lookup.'));
    submit = sandbox
      .stub(ConnectFlowVersionPruneJobClient.prototype, 'submitPrune')
      .rejects(new Error('Must not submit.'));
    list = sandbox.stub(ConnectFlowVersionListClient.prototype, 'list').rejects(new Error('Must not list versions.'));
    confirm = sandbox.stub(ConfirmationPrompt.prototype, 'confirm').resolves(false);
  });

  afterEach(() => {
    expect(submit.called || list.called || confirm.called).to.equal(false);
    for (const call of request.getCalls()) expect((call.args[0] as { method: string }).method).to.equal('GET');
    sandbox.restore();
    process.exitCode = originalExitCode;
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!originalSignalListeners.get(signal)?.includes(listener)) process.removeListener(signal, listener);
      }
    }
  });

  for (const status of statuses) {
    for (const json of [false, true]) {
      it(`reports ${status} in ${json ? 'JSON' : 'console'} without polling or mutations`, async () => {
        setJob(status);
        const result = await FlowVersionJobReportCommand.run([...args, ...(json ? ['--json'] : [])]);
        expect(result).to.deep.equal({
          jobId,
          jobStatus: status,
          status,
          targetOrg: username,
          apiVersion,
          error: null,
          truncated: false,
          versions: [],
          warnings: [],
          notes: [],
        });
        expect(lookup.calledOnceWithExactly(jobId)).to.equal(true);
        expect(getConnection.calledOnceWithExactly('69.0')).to.equal(true);
        expect(request.callCount).to.equal(status === 'Scheduled' || status === 'Running' ? 0 : 1);
        expect(process.exitCode).to.equal(status === 'Error' ? 1 : 0);
        expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
        if (json) {
          expect(log.called || logToStderr.called).to.equal(false);
          expect(logJson.calledOnce).to.equal(true);
        } else {
          expect(log.calledOnce).to.equal(true);
          expect(logJson.called).to.equal(false);
          const output = String(log.firstCall.args[0]);
          expect(output).to.include(`Job ID: ${jobId}`).and.include(`Status: ${status}`).and.include(username);
          expect(output.startsWith('\n') && output.endsWith('\n')).to.equal(true);
        }
      });
    }
  }

  for (const json of [false, true]) {
    it(`reports a Complete prune with deleted and blocked versions in ${json ? 'JSON' : 'console'}`, async () => {
      setJob(
        'Complete',
        `Account_Onboarding ${deletedId} DELETED\nAccount_Onboarding ${blockedId} BLOCKED HAS_INTERVIEWS`
      );
      const result = await FlowVersionJobReportCommand.run([...args, ...(json ? ['--json'] : [])]);
      expect(result.versions).to.deep.equal([
        { flowApiName: 'Account_Onboarding', versionId: deletedId, outcome: 'DELETED', reason: null },
        { flowApiName: 'Account_Onboarding', versionId: blockedId, outcome: 'BLOCKED', reason: 'HAS_INTERVIEWS' },
      ]);
      expect(result.jobStatus).to.equal('Complete');
      expect(result.error).to.equal(null);
      expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
      expect(process.exitCode).to.equal(0);
      if (json) expect(log.called || logToStderr.called).to.equal(false);
      else {
        const output = String(log.firstCall.args[0]);
        for (const value of ['Account_Onboarding', deletedId, blockedId, 'DELETED', 'BLOCKED', 'HAS_INTERVIEWS'])
          expect(output).to.include(value);
        expect(output.indexOf('Status: Complete')).to.be.lessThan(output.indexOf('HAS_INTERVIEWS'));
      }
    });

    it(`reports Complete bulk-delete results in ${json ? 'JSON' : 'console'}`, async () => {
      setJob('Complete', `BULK_DELETE ${blockedId} FAILED NOT_FOUND\nDELETE ${deletedId} DELETED`);
      const result = await FlowVersionJobReportCommand.run([...args, ...(json ? ['--json'] : [])]);
      expect(result.versions).to.deep.equal([
        { flowApiName: null, versionId: blockedId, outcome: 'FAILED', reason: 'NOT_FOUND' },
        { flowApiName: null, versionId: deletedId, outcome: 'DELETED', reason: null },
      ]);
      expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
      if (!json)
        expect(String(log.firstCall.args[0])).to.include('NOT_FOUND').and.include('FAILED').and.include('DELETED');
    });

    it(`reports an Error job with an empty result in ${json ? 'JSON' : 'console'}`, async () => {
      setJob('Error', '', 'The server job exceeded its execution timeout.');
      const result = await FlowVersionJobReportCommand.run([...args, ...(json ? ['--json'] : [])]);
      expect(result.error).to.equal('The server job exceeded its execution timeout.');
      expect(result.versions).to.deep.equal([]);
      expect(process.exitCode).to.equal(1);
      expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
      if (!json) expect(String(log.firstCall.args[0])).to.include(`Job error: ${result.error}`);
    });

    it(`reports truncation as a warning in ${json ? 'JSON' : 'console'}`, async () => {
      setJob(
        'Complete',
        `Account_Onboarding ${deletedId} DELETED\nPRUNE stopped after 500 versions; run the job again for the rest\nresult truncated`
      );
      const result = await FlowVersionJobReportCommand.run([...args, ...(json ? ['--json'] : [])]);
      expect(result.truncated).to.equal(true);
      expect(result.versions).to.have.length(1);
      expect(result.warnings).to.deep.equal([
        'PRUNE stopped after 500 versions; run the job again for the rest',
        'result truncated',
      ]);
      expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
      if (!json)
        expect(String(log.firstCall.args[0])).to.include('Warning: result truncated').and.include('run the job again');
    });
  }

  for (const status of ['Scheduled', 'Running'] as const) {
    it(`does not invent outcomes for a ${status} job even when the response has partial results`, async () => {
      lookup.resolves({ jobId, status, result: `Account_Onboarding ${deletedId} DELETED` });
      const result = await FlowVersionJobReportCommand.run([...args, '--json']);
      expect(result.versions).to.deep.equal([]);
      expect(result.error).to.equal(null);
      expect(request.called).to.equal(false);
    });
  }

  it('shows the stored job error before partially completed version outcomes', async () => {
    setJob(
      'Error',
      `Account_Onboarding ${deletedId} DELETED\nAccount_Onboarding ${blockedId} FAILED DELETE_ERROR`,
      'A later flow failed.'
    );
    const result = await FlowVersionJobReportCommand.run(args);
    const output = String(log.firstCall.args[0]);
    expect(result.versions).to.have.length(2);
    expect(output.indexOf('Status: Error')).to.be.lessThan(output.indexOf('Job error: A later flow failed.'));
    expect(output.indexOf('Job error: A later flow failed.')).to.be.lessThan(output.indexOf(deletedId));
    expect(output).to.include('FAILED').and.include('DELETE_ERROR');
  });

  it('requires a job id and performs no lookup when it is absent', async () => {
    const error = await failure(['--target-org', 'source']);
    expect(error.exitCode).to.equal(2);
    expect(lookup.called).to.equal(false);
  });

  it('does not introduce a wait flag or polling behavior', async () => {
    const error = await failure([...args, '--wait', '5']);
    expect(error.exitCode).to.equal(2);
    expect(lookup.called).to.equal(false);
  });

  it('maps an invalid job id rejected by the SDK to usage exit 2', async () => {
    lookup.rejects(new FlowVersionError('INVALID_PRUNE_JOB_ID', 'Core must provide a valid operation job ID.'));
    const error = await failure([...args.slice(0, -1), '../jobs']);
    expect(error.exitCode).to.equal(2);
    expect(lookup.calledOnceWithExactly('../jobs')).to.equal(true);
  });

  it('maps an unsupported API version to usage exit 2', async () => {
    apiVersion = '66.0';
    lookup.rejects(
      new FlowVersionPruneJobRequestError(
        'PRUNE_JOB_API_VERSION_UNSUPPORTED',
        'Async Flow prune requires API version 67.0 or later.',
        jobId,
        false,
        null
      )
    );
    const error = await failure(['--target-org', 'source', '--api-version', '66.0', '--job-id', jobId]);
    expect(error.exitCode).to.equal(2);
  });

  for (const [statusCode, code, message] of [
    [404, 'NOT_FOUND', 'The requested resource does not exist'],
    [500, 'UNKNOWN_EXCEPTION', 'The operation status could not be read.'],
  ] as const) {
    it(`returns failure for HTTP ${statusCode} and retains the requested job id`, async () => {
      lookup.rejects(new FlowVersionPruneJobRequestError(code, message, jobId, true, statusCode));
      const error = await failure([...args, '--json']);
      expect(error).to.be.instanceOf(SfError);
      expect(error.name).to.equal(code);
      expect(error.message).to.equal(message);
      expect(error.exitCode).to.equal(1);
      expect(error.data).to.include({ jobId, statusCode });
      expect(lookup.calledOnceWithExactly(jobId)).to.equal(true);
      expect(request.called || log.called || logToStderr.called).to.equal(false);
    });
  }

  it('does not fabricate a report for a malformed SDK status response', async () => {
    lookup.rejects(
      new FlowVersionPruneJobRequestError(
        'INVALID_PRUNE_JOB_RESPONSE',
        'Core returned an unsupported operation status.',
        jobId,
        true,
        200
      )
    );
    const error = await failure(args);
    expect(error.exitCode).to.equal(1);
    expect(error.data).to.include({ jobId, statusCode: 200 });
    expect(log.called).to.equal(false);
  });

  it('fails rather than treating unreadable stored outcomes as successful deletions', async () => {
    setJob('Complete');
    request.resolves({ Status: 'Complete', Result: 'MASKED', Error: null });
    const error = await failure(args);
    expect(error.name).to.equal('INVALID_FLOW_JOB_REPORT_RESPONSE');
    expect(error.exitCode).to.equal(1);
    expect(log.called).to.equal(false);
  });

  it('uses the actual connection API version and org label fallback', async () => {
    username = undefined;
    apiVersion = '68.0';
    const result = await FlowVersionJobReportCommand.run(['-o', 'source', '--api-version', '68.0', '--job-id', jobId]);
    expect(result).to.include({ targetOrg: 'authenticated org', apiVersion: '68.0' });
    expect(getConnection.calledOnceWithExactly('68.0')).to.equal(true);
  });

  it('removes terminal controls from the human-readable error and label without changing JSON facts', async () => {
    username = 'unit\u001b[31m@example.invalid\nsecond';
    const rawError = 'Failed.\u001b[31mDetails\u001b[0m\r\u0007\u202e';
    setJob('Error', null, rawError);
    const result = await FlowVersionJobReportCommand.run(args);
    const output = String(log.firstCall.args[0]);
    for (const control of ['\u001b', '\u0007', '\u202e', '\r']) expect(output).not.to.include(control);
    expect(output).not.to.include('\nsecond');
    expect(output).to.include('unit@example.invalid second').and.include('Failed.Details');
    expect(result.error).to.equal(rawError);
  });
});
