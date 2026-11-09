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
import { Org, type Connection, type SfError } from '@salesforce/core';
import {
  FlowVersionDeleteService,
  FlowVersionForceDeleteService,
  FlowVersionError,
  type FlowVersionForceDeletePlan,
  type FlowVersionForceDeleteResult,
} from '@salesforce/flow-node';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import FlowVersionDelete from '../../../../src/commands/flow/version/delete.js';
import {
  formatVersionForceDeleteReport,
  runForceVersionDeletion,
  type FlowVersionForceDeleteCommandReport,
} from '../../../../src/services/flowVersionForceDeletion.js';
import { ForceDeleteConfirmationPrompt } from '../../../../src/ux/forceDeleteConfirmation.js';
import { ConfirmationPrompt } from '../../../../src/ux/confirmation.js';
import { ConfirmationTimeoutError } from '../../../../src/ux/confirmationTimeout.js';
import { type FlowVersionMutationReport } from '../../../../src/reporters/flowVersionMutationReport.js';

const schema = JSON.parse(
  readFileSync(new URL('../../../../schemas/flow-version-delete.json', import.meta.url), 'utf8')
) as object;
const validateReport = new Ajv({ allErrors: true }).compile(schema);

const planFixture = (): FlowVersionForceDeletePlan => ({
  contractVersion: '1',
  orgId: '00D000000000001EAA',
  definitionId: '300xx000000bojNAAQ',
  versionId: '301xx000003Ga19AAC',
  flowName: 'Invoice_Approval',
  namespace: null,
  versionNumber: 2,
  availableVersionCount: 4,
  impact: {
    versionId: '301xx000003Ga19AAC',
    flowApiName: 'Invoice_Approval',
    versionNumber: 2,
    versionStatus: 'Draft',
    deletable: false,
    evaluationComplete: true,
    reasons: [{ code: 'PAUSED_INTERVIEWS', message: 'Two saved interviews.', count: 2, relatedResources: [] }],
    interviews: [
      {
        id: '0Fo000000000001',
        status: 'Paused',
        label: 'Invoice pause',
        createdDate: '2026-10-01T00:00:00Z',
        ownerId: '005000000000001',
      },
      { id: '0Fo000000000002', status: 'Pending', label: null, createdDate: null, ownerId: null },
    ],
    interviewsTruncated: false,
    interviewCountLowerBound: 2,
    coverage: 'KNOWN_BLOCKERS',
    eligibilityIsAdvisory: true,
  },
  executionBlockers: [],
});

const resultFixture = (plan: FlowVersionForceDeletePlan): FlowVersionForceDeleteResult => ({
  contractVersion: '1',
  mode: 'FORCE',
  orgId: plan.orgId,
  definitionId: plan.definitionId,
  versionId: plan.versionId,
  flowName: plan.flowName,
  namespace: plan.namespace,
  versionNumber: plan.versionNumber,
  state: 'DELETED',
  source: 'BACKEND',
  targetDeleted: true,
  operationId: 'operation-unit-only',
  interviewIds: ['0Fo000000000001', '0Fo000000000002'],
  scheduledWorkIds: [],
  reasons: [],
  errors: [],
  preview: null,
  hasMore: false,
  operations: [],
  error: null,
});

const runForce = async (args: string[]): Promise<FlowVersionMutationReport> => {
  const result = await FlowVersionDelete.run(args);
  if (result.mode !== 'FORCE') throw new Error('A force command routed to normal deletion.');
  return result;
};

describe('flow version delete --force command', () => {
  const sandbox = sinon.createSandbox();
  const args = ['--target-org', 'source', '--flow', 'Invoice_Approval', '--versions', '2', '--force'];
  let plan: FlowVersionForceDeletePlan;
  let result: FlowVersionForceDeleteResult;
  let preview: sinon.SinonStub;
  let execute: sinon.SinonStub;
  let cancel: sinon.SinonStub;
  let confirm: sinon.SinonStub;
  let normalPlan: sinon.SinonStub;
  let normalExecute: sinon.SinonStub;
  let normalConfirm: sinon.SinonStub;
  let getConnection: sinon.SinonStub;
  let request: sinon.SinonStub;
  let log: sinon.SinonStub;
  let logJson: sinon.SinonStub;
  let logToStderr: sinon.SinonStub;
  let originalExitCode: typeof process.exitCode;
  let ttyDescriptors: Array<PropertyDescriptor | undefined>;

  const tty = (stdin = true, stdout = true, stderr = true): void => {
    for (const [stream, interactive] of [
      [process.stdin, stdin],
      [process.stdout, stdout],
      [process.stderr, stderr],
    ] as const)
      Object.defineProperty(stream, 'isTTY', { configurable: true, value: interactive });
  };

  const expectError = async (argv: string[], fragment: string): Promise<Error> => {
    let caught: unknown;
    try {
      await FlowVersionDelete.run(argv);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.include(fragment);
    return caught as Error;
  };

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    ttyDescriptors = [process.stdin, process.stdout, process.stderr].map((stream) =>
      Object.getOwnPropertyDescriptor(stream, 'isTTY')
    );
    tty();
    plan = planFixture();
    result = resultFixture(plan);
    const ux = stubSfCommandUx(sandbox);
    log = ux.log;
    logJson = ux.logJson;
    logToStderr = ux.logToStderr;
    request = sandbox.stub();
    getConnection = sandbox.stub().returns({
      getApiVersion: () => '67.0',
      getAuthInfoFields: () => ({ orgId: plan.orgId }),
      tooling: { query: sandbox.stub(), queryMore: sandbox.stub() },
      request,
    });
    sandbox.stub(Org, 'create').resolves({ getConnection, getUsername: () => 'poc@example.com' } as unknown as Org);
    preview = sandbox.stub(FlowVersionForceDeleteService.prototype, 'preview').resolves(plan);
    execute = sandbox.stub(FlowVersionForceDeleteService.prototype, 'execute').resolves(result);
    cancel = sandbox.stub(FlowVersionForceDeleteService.prototype, 'cancel');
    confirm = sandbox.stub(ForceDeleteConfirmationPrompt.prototype, 'confirm').resolves(false);
    normalPlan = sandbox.stub(FlowVersionDeleteService.prototype, 'plan');
    normalExecute = sandbox.stub(FlowVersionDeleteService.prototype, 'execute');
    normalConfirm = sandbox.stub(ConfirmationPrompt.prototype, 'confirm');
  });

  afterEach(() => {
    sandbox.restore();
    process.exitCode = originalExitCode;
    for (const [index, stream] of [process.stdin, process.stdout, process.stderr].entries()) {
      const descriptor = ttyDescriptors[index];
      if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
      else Reflect.deleteProperty(stream, 'isTTY');
    }
  });

  it('routes dry-run only through force preview and returns the new report schema', async () => {
    const report = await runForce([...args, '--dry-run']);
    expect(
      preview.calledOnceWithExactly({ flowName: 'Invoice_Approval', versionNumber: 2, namespace: undefined })
    ).to.equal(true);
    expect(report).to.include({
      mode: 'FORCE',
      contractVersion: '3',
      dryRun: true,
      outcome: 'previewed',
      confirmed: false,
    });
    expect(report.execution).to.equal(null);
    expect(report).not.to.have.property('plan');
    expect(
      confirm.called ||
        execute.called ||
        normalPlan.called ||
        normalExecute.called ||
        normalConfirm.called ||
        request.called
    ).to.equal(false);
    expect(cancel.calledOnceWithExactly(plan)).to.equal(true);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
    expect(process.exitCode).to.equal(0);
  });

  for (const expression of [
    '1,2',
    '1-1',
    '1-3',
    '0',
    '01',
    '-2',
    '2.5',
    '9007199254740992',
    Array.from({ length: 51 }, (_, i) => i + 1).join(','),
  ]) {
    it(`rejects a non-single version expression ${expression} before opening a connection`, async () => {
      await expectError(
        ['--target-org', 'source', '--flow', 'Invoice_Approval', '--versions', expression, '--force'],
        'exactly one positive version'
      );
      expect(getConnection.called || preview.called || execute.called || request.called).to.equal(false);
    });
  }

  for (const selection of [
    ['--target-org', 'source', '--flow', 'Invoice-Approval', '--versions', '2', '--force', '--dry-run'],
    [...args, '--namespace', 'invalid-namespace', '--dry-run'],
  ]) {
    it(`maps actual SDK identifier validation to usage exit 2 before inventory: ${selection.join(' ')}`, async () => {
      preview.restore();
      const failure = await expectError(selection, 'valid Flow API name');
      expect((failure as SfError).code).to.equal('INVALID_IDENTIFIER');
      expect((failure as SfError).exitCode).to.equal(2);
      const connection = getConnection.firstCall.returnValue as {
        tooling: { query: sinon.SinonStub; queryMore: sinon.SinonStub };
      };
      expect(connection.tooling.query.called || connection.tooling.queryMore.called || request.called).to.equal(false);
      expect(execute.called || confirm.called).to.equal(false);
    });
  }

  it('keeps actual malformed inventory from the SDK as runtime exit 1', async () => {
    preview.restore();
    const failure = await expectError([...args, '--dry-run'], 'inventory is invalid');
    expect((failure as SfError).code).to.equal('INVALID_INVENTORY');
    expect((failure as SfError).exitCode).to.equal(1);
    const connection = getConnection.firstCall.returnValue as { tooling: { query: sinon.SinonStub } };
    expect(connection.tooling.query.calledOnce).to.equal(true);
    expect(request.called || execute.called || confirm.called).to.equal(false);
  });

  it('requires interactive input and output before any API call, including dry-run with --yes', async () => {
    tty(false, true, true);
    await expectError([...args, '--dry-run', '--yes'], 'interactive input and output');
    tty(true, false, true);
    await expectError([...args, '--yes'], 'interactive input and output');
    expect(getConnection.called || preview.called || execute.called || confirm.called).to.equal(false);
  });

  for (const extra of [[], ['--dry-run'], ['--no-prompt'], ['--yes', '--dry-run']]) {
    it(`rejects force JSON before inventory or HTTP: ${extra.join(' ') || 'execution'}`, async () => {
      const failure = await expectError([...args, ...extra, '--json'], 'cannot be used with --json');
      expect((failure as SfError).exitCode).to.equal(2);
      expect(getConnection.called || preview.called || execute.called || request.called || confirm.called).to.equal(
        false
      );
    });
  }

  it('rejects repeated versions before opening a connection even when the values are identical', async () => {
    const failure = await expectError([...args, '--versions', '2'], 'exactly one positive version');
    expect((failure as SfError).exitCode).to.equal(2);
    expect(getConnection.called || preview.called || execute.called || request.called).to.equal(false);
  });

  it('shows reasons and interviews before typed confirmation even when deletable is false', async () => {
    const report = await runForce([...args, '--yes']);
    expect(plan.impact.deletable).to.equal(false);
    expect(confirm.calledOnce).to.equal(true);
    expect(report.outcome).to.equal('cancelled');
    expect(execute.called).to.equal(false);
    expect(log.firstCall.args[0])
      .to.include('PAUSED_INTERVIEWS (2)')
      .and.include('Invoice pause')
      .and.include('Status: Pending');
    expect(log.calledBefore(confirm)).to.equal(true);
    expect(
      log
        .getCalls()
        .some((call) => String(call.args[0]).includes('--no-prompt and its compatibility aliases are ignored'))
    ).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({
      flowApiName: 'Invoice_Approval',
      versionNumber: 2,
      ms: 120_000,
      output: process.stdout,
    });
    expect(process.exitCode).to.equal(1);
    expect(cancel.calledOnceWithExactly(plan)).to.equal(true);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('uses the backend-qualified name for typed confirmation and forwards the explicit namespace', async () => {
    plan.namespace = 'billing';
    plan.impact.flowApiName = 'billing__Invoice_Approval';
    await runForce([...args, '--namespace', 'billing']);
    expect(preview.firstCall.args[0]).to.deep.equal({
      flowName: 'Invoice_Approval',
      versionNumber: 2,
      namespace: 'billing',
    });
    expect(confirm.firstCall.args[0]).to.include({ flowApiName: 'billing__Invoice_Approval' });
  });

  it('preserves bare name/value arguments and explicit API version in force mode', async () => {
    const report = await runForce([
      'target-org',
      'source',
      'flow',
      'Invoice_Approval',
      'versions',
      '2',
      'api-version',
      '67.0',
      '--force',
      '--dry-run',
    ]);
    expect(getConnection.calledOnceWithExactly('67.0')).to.equal(true);
    expect(report.mode).to.equal('FORCE');
    expect(preview.firstCall.args[0]).to.include({ versionNumber: 2 });
  });

  for (const code of [
    'ACTIVE_VERSION',
    'PACKAGED_VERSION',
    'LATEST_PACKAGED_VERSION',
    'INSUFFICIENT_ACCESS',
    'INSUFFICIENT_PERMISSION',
    'NOT_FOUND',
    'INVALID_VERSION_ID',
    'EVALUATION_FAILED',
    'UNDER_REVIEW',
    'UNSUPPORTED_VERSION_STATUS',
    'SUBFLOW_PARENT',
    'REFERENCED_BY_ACTIVE_VERSION',
    'REFERENCED_BY_INACTIVE_VERSION',
    'REFERENCED_BY_OTHER_RESOURCE',
    'REFERENCES_TRUNCATED',
    'SUBFLOW_PARENTS_TRUNCATED',
  ]) {
    it(`shows the SDK ${code} blocker without prompting or executing`, async () => {
      plan.impact.reasons = [{ code, message: `Backend ${code}`, count: null, relatedResources: [] }];
      plan.executionBlockers = [{ code, message: `Backend ${code}` }];
      const report = await runForce(args);
      expect(report.outcome).to.equal('blocked');
      expect(process.exitCode).to.equal(1);
      expect(confirm.called || execute.called || normalPlan.called || normalExecute.called || request.called).to.equal(
        false
      );
      expect(log.firstCall.args[0]).to.include(code);
      expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
    });
  }

  it('preserves incomplete evaluation and lower bounds without inventing eligibility or counts', async () => {
    plan.impact.evaluationComplete = false;
    plan.impact.interviewsTruncated = true;
    plan.impact.interviewCountLowerBound = 19;
    plan.executionBlockers = [{ code: 'EVALUATION_FAILED', message: 'Evaluation incomplete.' }];
    const report = await runForce([...args, '--dry-run']);
    expect(report.outcome).to.equal('previewed');
    expect(report.impact!.interviewCountLowerBound).to.equal(19);
    expect(report.impact!.evaluationComplete).to.equal(false);
    expect(process.exitCode).to.equal(0);
    expect(confirm.called || execute.called).to.equal(false);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('executes only after typed approval and returns DELETED without an inferred abandoned count', async () => {
    confirm.resolves(true);
    const report = await runForce(args);
    expect(execute.calledOnce).to.equal(true);
    expect(execute.firstCall.args[0]).to.equal(plan);
    const options = execute.firstCall.args[1] as NonNullable<Parameters<FlowVersionForceDeleteService['execute']>[1]>;
    expect(options.signal).to.be.instanceOf(AbortSignal);
    expect(report).to.include({ confirmed: true, outcome: 'succeeded' });
    expect(confirm.firstCall.args[0]).to.include({ flowApiName: 'Invoice_Approval', versionNumber: 2 });
    expect(report.execution?.interviewIds).to.deep.equal(['0Fo000000000001', '0Fo000000000002']);
    expect(process.exitCode).to.equal(0);
    expect(cancel.calledOnceWithExactly(plan)).to.equal(true);
    expect(normalPlan.called || normalExecute.called || normalConfirm.called || request.called).to.equal(false);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
    expect(JSON.stringify(report)).not.to.include('abandonedInterviewCount').and.not.to.include('confirmationToken');
  });

  it('displays continuation progress in the terminal without changing the exact version', async () => {
    confirm.resolves(true);
    execute.callsFake(async (_plan, options: Parameters<FlowVersionForceDeleteService['execute']>[1]) => {
      options?.onProgress?.({
        operationId: 'operation-unit-only',
        versionId: plan.versionId,
        outcome: 'IN_PROGRESS',
        interviewIds: ['0Fo000000000001'],
        scheduledWorkIds: [],
        reasons: [],
        errors: [],
        preview: null,
        hasMore: true,
      });
      return result;
    });
    const report = await runForce([...args, '--no-prompt']);
    expect(log.calledBefore(confirm)).to.equal(true);
    expect(log.getCalls().some((call) => String(call.args[0]).includes('IN_PROGRESS'))).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({ output: process.stdout });
    expect(logToStderr.called || logJson.called).to.equal(false);
    expect(report.outcome).to.equal('succeeded');
    expect(execute.firstCall.args[0]).to.equal(plan);
  });

  it('returns timeout 69 only for an actual typed-confirmation deadline', async () => {
    confirm.rejects(new ConfirmationTimeoutError());
    const report = await runForce(args);
    expect(report.outcome).to.equal('timed_out');
    expect(process.exitCode).to.equal(69);
    expect(execute.called).to.equal(false);
    expect(cancel.calledOnceWithExactly(plan)).to.equal(true);
    expect(log.lastCall.args[0]).to.include('timed out');
  });

  for (const state of ['BLOCKED', 'FAILED', 'UNKNOWN'] as const) {
    it(`preserves ${state}, reasons and errors without retry and exits nonzero`, async () => {
      Object.assign(result, {
        state,
        targetDeleted: state === 'UNKNOWN' ? null : false,
        reasons: [
          { code: 'INSUFFICIENT_ACCESS', message: 'Force permission required.', count: null, relatedResources: [] },
        ],
        errors: [{ code: 'BACKEND_ERROR', message: 'The operation did not finish.' }, 'Additional backend detail'],
        error: null,
      });
      confirm.resolves(true);
      const report = await runForce(args);
      expect(report.outcome).to.equal(state.toLowerCase());
      expect(process.exitCode).to.equal(1);
      expect(preview.calledOnce && execute.calledOnce && confirm.calledOnce).to.equal(true);
      expect(log.lastCall.args[0])
        .to.include('INSUFFICIENT_ACCESS')
        .and.include('BACKEND_ERROR')
        .and.include('Additional backend detail');
      expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
    });
  }

  it('refuses to execute if a terminal is lost during typed confirmation', async () => {
    confirm.callsFake(async () => {
      tty(true, false, true);
      return true;
    });
    await expectError(args, 'interactive input and output');
    expect(execute.called).to.equal(false);
    expect(cancel.calledOnce).to.equal(true);
  });

  it('cleans up its plan on a prompt failure without executing or retrying', async () => {
    confirm.rejects(new Error('Prompt transport failed.'));
    await expectError(args, 'Prompt transport failed');
    expect(execute.called).to.equal(false);
    expect(cancel.calledOnce).to.equal(true);
  });

  it('stops on an HTTP/SDK execution failure and removes its own signal handlers', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    confirm.resolves(true);
    execute.callsFake(async () => {
      expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).to.deep.equal(
        before.map((count) => count + 1)
      );
      throw new FlowVersionError('FORCE_DELETE_REJECTED', 'The server rejected force deletion (HTTP 400).');
    });
    let failure: unknown;
    try {
      await runForceVersionDeletion({
        connection: getConnection() as Connection,
        targetOrg: 'poc@example.com',
        flowName: 'Invoice_Approval',
        versionNumber: 2,
        dryRun: false,
        yes: false,
        json: false,
        display: (message: string): void => {
          log(message);
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.instanceOf(Error);
    expect((failure as Error).message).to.include('HTTP 400');
    expect(execute.calledOnce).to.equal(true);
    expect(cancel.calledOnce).to.equal(true);
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).to.deep.equal(before);
  });

  it('maps SDK preview errors without confirming or executing', async () => {
    preview.rejects(new FlowVersionError('FORCE_PREVIEW_FAILED', 'Unable to obtain a force preview.'));
    await expectError([...args, '--dry-run'], 'Unable to obtain a force preview');
    expect(confirm.called || execute.called || cancel.called).to.equal(false);
  });

  it('renders every supplied reason, related resource and interview field without obsolete metrics', async () => {
    plan.impact.reasons.push({
      code: 'SCHEDULED_WORK_TRUNCATED',
      message: 'More scheduled work exists.',
      relatedResources: [{ id: 'scheduled-unit', name: 'Invoice reminder' }],
    });
    const report = await runForce([...args, '--dry-run']);
    const internal: FlowVersionForceDeleteCommandReport = {
      contractVersion: '1',
      mode: 'FORCE',
      targetOrg: report.targetOrg,
      apiVersion: report.apiVersion,
      dryRun: true,
      confirmed: false,
      confirmationMethod: null,
      outcome: 'PREVIEWED',
      plan,
      deletion: null,
    };
    const rendered = formatVersionForceDeleteReport(internal);
    expect(rendered)
      .to.include('Invoice reminder')
      .and.include('Invoice pause')
      .and.include('2026-10-01T00:00:00Z')
      .and.include('005000000000001');
    expect(rendered)
      .to.include('KNOWN_BLOCKERS')
      .and.include('Eligibility advisory: true')
      .and.include('Interview count lower bound: 2');
    expect(rendered).to.include('cannot be resumed or retried').and.include('cannot be undone');
    expect(rendered)
      .not.to.include('Work items:')
      .and.not.to.include('Distinct users:')
      .and.not.to.include('Orchestrations in progress:');
  });

  it('sanitizes terminal controls without altering structured server values', async () => {
    plan.impact.reasons[0].message = 'A server message\u001b[31m\n';
    plan.impact.interviews[0].label = 'Interview\u001b[31m\n';
    const report = await runForce([...args, '--dry-run']);
    const internal: FlowVersionForceDeleteCommandReport = {
      contractVersion: '1',
      mode: 'FORCE',
      targetOrg: report.targetOrg,
      apiVersion: report.apiVersion,
      dryRun: true,
      confirmed: false,
      confirmationMethod: null,
      outcome: 'PREVIEWED',
      plan,
      deletion: null,
    };
    const rendered = formatVersionForceDeleteReport(internal);
    expect(rendered).not.to.include('\u001b');
    expect(report.impact!.interviews[0].label).to.equal('Interview\u001b[31m\n');
  });

  it('rejects unexpected report fields and fake success through its JSON schema', async () => {
    const report = await runForce([...args, '--dry-run']);
    expect(validateReport({ ...report, confirmationToken: 'obsolete' })).to.equal(false);
    expect(validateReport({ ...report, outcome: 'DELETED' })).to.equal(false);
  });
});
