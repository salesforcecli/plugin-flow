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
import { Org } from '@salesforce/core';
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
  type FlowVersionForceDeleteCommandReport,
} from '../../../../src/services/flowVersionForceDeletion.js';
import { ForceDeleteConfirmationPrompt } from '../../../../src/ux/forceDeleteConfirmation.js';
import { ConfirmationPrompt } from '../../../../src/ux/confirmation.js';

const schema = JSON.parse(
  readFileSync(new URL('../../../../schemas/flow-version-force-delete.json', import.meta.url), 'utf8')
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
    flowApiName: 'Invoice_Approval',
    versionNumber: 2,
    eligible: true,
    reasonCode: null,
    pausedInterviewCount: 3,
    failedInterviewCount: 2,
    otherInterviewCount: 1,
    distinctUserCount: 4,
    oldestInterviewAgeDays: 16,
    orchestrationInProgressCount: 0,
    referencingVersionCount: 0,
    scheduledResumeWithin7Days: null,
    workItemCount: null,
  },
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  clientPolicyError: null,
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
  state: 'SUCCEEDED',
  source: 'BACKEND',
  targetDeleted: true,
  abandonedInterviewCount: 6,
  error: null,
});

const runForce = async (args: string[]): Promise<FlowVersionForceDeleteCommandReport> => {
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

  const expectError = async (argv: string[], fragment: string): Promise<void> => {
    let caught: unknown;
    try {
      await FlowVersionDelete.run(argv);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.include(fragment);
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

  it('routes force preview only through the dedicated force service and burns its private capability', async () => {
    const report = await runForce([...args, '--dry-run']);
    expect(
      preview.calledOnceWithExactly({ flowName: 'Invoice_Approval', versionNumber: 2, namespace: undefined })
    ).to.equal(true);
    expect(report).to.include({
      mode: 'FORCE',
      contractVersion: '1',
      dryRun: true,
      outcome: 'PREVIEWED',
      confirmed: false,
    });
    expect(report.deletion).to.equal(null);
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
    expect(process.exitCode).to.equal(undefined);
  });

  for (const expression of ['1,2', '1-1', '1-3', '0', '01', '-2', '2.5', '9007199254740992']) {
    it(`rejects a non-single version expression ${expression} before opening a connection`, async () => {
      await expectError(
        ['--target-org', 'source', '--flow', 'Invoice_Approval', '--versions', expression, '--force'],
        'exactly one positive version'
      );
      expect(getConnection.called || preview.called || execute.called).to.equal(false);
    });
  }

  it('requires interactive stdin even for force dry run and --yes', async () => {
    tty(false, true, true);
    await expectError([...args, '--dry-run', '--yes'], 'interactive input and output');
    expect(getConnection.called || preview.called || execute.called || confirm.called).to.equal(false);
  });

  it('requires interactive stdout before any API call', async () => {
    tty(true, false, true);
    await expectError([...args, '--yes'], 'interactive input and output');
    expect(getConnection.called || preview.called || execute.called).to.equal(false);
  });

  it('requires interactive stderr for JSON execution, while permitting a JSON-only preview', async () => {
    tty(true, true, false);
    await expectError([...args, '--yes', '--json'], 'interactive stderr');
    expect(getConnection.called).to.equal(false);
    logJson.resetHistory();
    const report = await runForce([...args, '--dry-run', '--json']);
    expect(report.outcome).to.equal('PREVIEWED');
    expect(log.called || logToStderr.called || confirm.called || execute.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
  });

  it('ignores --yes and still requests exact Flow/version confirmation after showing the full impact', async () => {
    const report = await runForce([...args, '--yes']);
    expect(confirm.calledOnce).to.equal(true);
    expect(report.outcome).to.equal('CANCELLED');
    expect(execute.called).to.equal(false);
    expect(log.firstCall.args[0]).to.include('Paused interviews: 3').and.include('Failed interviews: 2');
    expect(log.calledBefore(confirm)).to.equal(true);
    expect(log.getCalls().some((call) => String(call.args[0]).includes('--yes is ignored'))).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({
      flowApiName: 'Invoice_Approval',
      versionNumber: 2,
      ms: 120_000,
      output: process.stdout,
    });
    expect(cancel.calledOnceWithExactly(plan)).to.equal(true);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('uses backend-qualified Flow names for typed confirmation and forwards the explicit namespace', async () => {
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

  it('returns actual backend blockers without prompting or executing', async () => {
    plan.impact.eligible = false;
    plan.impact.reasonCode = 'ACTIVE_ORCHESTRATION';
    plan.impact.orchestrationInProgressCount = 2;
    plan.expiresAt = null;
    const report = await runForce(args);
    expect(report.outcome).to.equal('BLOCKED');
    expect(process.exitCode).to.equal(1);
    expect(confirm.called || execute.called).to.equal(false);
    expect(log.firstCall.args[0]).to.include('ACTIVE_ORCHESTRATION').and.include('Orchestrations in progress: 2');
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('keeps blocked preview exit zero and preserves null metadata instead of inventing counts', async () => {
    Object.assign(plan.impact, {
      eligible: false,
      reasonCode: 'NOT_FOUND',
      flowApiName: null,
      versionNumber: null,
      pausedInterviewCount: null,
      distinctUserCount: null,
    });
    plan.expiresAt = null;
    const report = await runForce([...args, '--dry-run', '--json']);
    expect(report.outcome).to.equal('PREVIEWED');
    expect(report.plan.impact.pausedInterviewCount).to.equal(null);
    expect(process.exitCode).to.equal(undefined);
    expect(confirm.called || execute.called).to.equal(false);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('keeps the last-version client policy distinct from backend eligibility', async () => {
    plan.clientPolicyError = { code: 'LAST_VERSION_PENDING_POLICY', message: 'Preserve the last remaining version.' };
    const report = await runForce(args);
    expect(report.plan.impact.eligible).to.equal(true);
    expect(report.outcome).to.equal('BLOCKED');
    expect(process.exitCode).to.equal(1);
    expect(confirm.called || execute.called).to.equal(false);
    expect(log.firstCall.args[0]).to.include('Client policy: LAST_VERSION_PENDING_POLICY');
  });

  it('refuses an expiring preview rather than shortening typing time or automatically refreshing', async () => {
    plan.expiresAt = new Date(Date.now() + 59_000).toISOString();
    await expectError(args, 'less than one minute remaining');
    expect(preview.calledOnce).to.equal(true);
    expect(confirm.called || execute.called).to.equal(false);
    expect(cancel.calledOnce).to.equal(true);
  });

  it('bounds typing by the remaining token lifetime without reducing it below one minute', async () => {
    const clock = sandbox.useFakeTimers({ now: Date.now() });
    plan.expiresAt = new Date(clock.now + 90_000).toISOString();
    await runForce(args);
    expect(confirm.firstCall.args[0]).to.include({ ms: 90_000 });
  });

  it('executes exactly once only after typed approval and returns the real abandoned count', async () => {
    confirm.resolves(true);
    const report = await runForce(args);
    expect(execute.calledOnceWithExactly(plan)).to.equal(true);
    expect(report).to.include({ confirmed: true, confirmationMethod: 'TYPED_FLOW_AND_VERSION', outcome: 'SUCCEEDED' });
    expect(report.deletion?.abandonedInterviewCount).to.equal(6);
    expect(cancel.calledOnceWithExactly(plan)).to.equal(true);
    expect(normalPlan.called || normalExecute.called || normalConfirm.called || request.called).to.equal(false);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('sends the human impact and typed prompt to stderr while JSON stdout remains clean', async () => {
    confirm.resolves(true);
    const report = await runForce([...args, '--json', '--yes']);
    expect(log.called).to.equal(false);
    expect(logToStderr.firstCall.args[0]).to.include('=== Impact preview');
    expect(logToStderr.calledBefore(confirm)).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({ output: process.stderr });
    expect(logJson.calledOnce).to.equal(true);
    expect(report.outcome).to.equal('SUCCEEDED');
    expect(JSON.stringify(report)).not.to.include('confirmationToken').and.not.to.include('expiresInSeconds');
  });

  for (const state of ['BLOCKED', 'FAILED', 'UNKNOWN'] as const) {
    it(`preserves SDK ${state} without retry and maps its execution exit code`, async () => {
      Object.assign(result, {
        state,
        targetDeleted: state === 'UNKNOWN' ? null : false,
        abandonedInterviewCount: null,
        error: { code: 'SERVER_RESULT', message: 'Use a fresh preview or reconcile the exact target.' },
      });
      confirm.resolves(true);
      const report = await runForce([...args, '--json']);
      expect(report.outcome).to.equal(state);
      expect(process.exitCode).to.equal(state === 'BLOCKED' ? 1 : 2);
      expect(preview.calledOnce && execute.calledOnce && confirm.calledOnce).to.equal(true);
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

  it('burns private preview state when the prompt fails and does not retry it', async () => {
    confirm.rejects(new Error('Prompt transport failed.'));
    await expectError(args, 'Prompt transport failed');
    expect(execute.called).to.equal(false);
    expect(cancel.calledOnce).to.equal(true);
  });

  it('maps SDK preview failures to typed CLI errors without executing', async () => {
    preview.rejects(new FlowVersionError('FORCE_PREVIEW_FAILED', 'Unable to obtain a force preview.'));
    await expectError([...args, '--dry-run'], 'Unable to obtain a force preview');
    expect(confirm.called || execute.called || cancel.called).to.equal(false);
  });

  it('renders real metrics, unknown scheduling/work items and irreversible effects without invented referencing versions', async () => {
    const report = await runForce([...args, '--dry-run']);
    const rendered = formatVersionForceDeleteReport(report);
    expect(rendered)
      .to.include('Other saved interviews: 1')
      .and.include('Distinct users: 4')
      .and.include('Oldest interview age: 16d');
    expect(rendered)
      .to.include('Referencing Flow versions: 0')
      .and.include('Unavailable (not stored on the interview)')
      .and.include('Unavailable (not keyed by Flow version)');
    expect(rendered).to.include('cannot be resumed or retried').and.include('cannot be undone');
    expect(rendered).not.to.include('Setup Audit Trail').and.not.to.include('Referencing versions: Parent');
  });

  it('sanitizes terminal controls in display without altering structured server values', async () => {
    plan.impact.flowApiName = 'Invoice_Approval\u001b[31m\n';
    const report = await runForce([...args, '--dry-run']);
    const rendered = formatVersionForceDeleteReport(report);
    expect(rendered).not.to.include('\u001b');
    expect(report.plan.impact.flowApiName).to.equal('Invoice_Approval\u001b[31m\n');
  });

  it('rejects unexpected report properties and a fake success through its documented JSON schema', async () => {
    const report = await runForce([...args, '--dry-run']);
    expect(validateReport({ ...report, confirmationToken: 'never-public' })).to.equal(false);
    expect(validateReport({ ...report, outcome: 'SUCCEEDED' })).to.equal(false);
  });
});
