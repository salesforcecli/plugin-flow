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

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { expect } from 'chai';
import sinon from 'sinon';
import { run as runCli } from '@oclif/core';
import { Org, SfError } from '@salesforce/core';
import {
  FlowVersionDeleteService,
  FlowVersionError,
  type FlowVersionDeleteExecutionReport,
  type FlowVersionDeletePlan,
  type FlowVersionDeleteTarget,
} from '@salesforce/flow-node';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import FlowVersionDelete, {
  formatVersionDeleteReport,
  type FlowVersionDeleteCommandReport,
} from '../../../../src/commands/flow/version/delete.js';
import { ConfirmationPrompt } from '../../../../src/ux/confirmation.js';
import { ConfirmationTimeoutError } from '../../../../src/ux/confirmationTimeout.js';
import {
  projectNormalReport,
  type FlowVersionMutationReport,
} from '../../../../src/reporters/flowVersionMutationReport.js';

const runNormal = async (args: string[]): Promise<FlowVersionMutationReport> => {
  const result = await FlowVersionDelete.run(args);
  if (result.mode !== 'NORMAL') throw new Error('A normal deletion command routed to force mode.');
  return result;
};

const schema = JSON.parse(
  readFileSync(new URL('../../../../schemas/flow-version-delete.json', import.meta.url), 'utf8')
) as object;
const validateReport = new Ajv({ allErrors: true }).compile(schema);

const planFixture = (): FlowVersionDeletePlan => ({
  contractVersion: '2',
  orgId: '00D000000000001EAA',
  flowName: 'Invoice_Approval',
  namespace: null,
  definitionId: '300xx000000bojNAAQ',
  requestedVersions: [2],
  versions: [
    {
      definitionId: '300xx000000bojNAAQ',
      versionId: '301xx000003Ga19AAC',
      flowName: 'Invoice_Approval',
      namespace: null,
      versionNumber: 2,
      status: 'Draft',
      assessment: {
        versionId: '301xx000003Ga19AAC',
        outcome: 'PASS',
        reasonCode: null,
        message: null,
        evidence: [],
      },
      error: null,
    },
  ],
  availableVersionCount: 3,
  warnings: ['Client selection checks are not atomic.'],
});

const deletionFixture = (plan: FlowVersionDeletePlan): FlowVersionDeleteExecutionReport => ({
  contractVersion: '2',
  mode: 'NORMAL',
  orgId: plan.orgId,
  flowName: plan.flowName,
  namespace: plan.namespace,
  definitionId: plan.definitionId,
  outcome: 'SUCCEEDED',
  results: plan.versions.map((version) => ({
    ...version,
    state: 'SUCCEEDED',
    targetDeleted: true,
    source: 'CORE',
    coreResult:
      version.versionId === null
        ? null
        : { versionId: version.versionId, outcome: 'DELETED', reasonCode: null, message: null, evidence: [] },
    error: null,
  })),
  warnings: [],
});

const commandReportFixture = (plan = planFixture()): FlowVersionDeleteCommandReport => ({
  contractVersion: '2',
  mode: 'NORMAL',
  targetOrg: 'poc@example.com',
  apiVersion: '67.0',
  dryRun: false,
  confirmed: false,
  outcome: 'PREVIEWED',
  plan,
  deletion: null,
});

const targetFixture = (versionNumber: number): FlowVersionDeleteTarget => {
  const versionId = `30100000000000${versionNumber}AAA`;
  return {
    definitionId: '300xx000000bojNAAQ',
    versionId,
    flowName: 'Invoice_Approval',
    namespace: null,
    versionNumber,
    status: versionNumber === 2 ? 'Active' : 'Draft',
    assessment: { versionId, outcome: 'PASS', reasonCode: null, message: null, evidence: [] },
    error: null,
  };
};

const blockTarget = (target: FlowVersionDeleteTarget, reasonCode: string, message = reasonCode): void => {
  Object.assign(target, {
    assessment: { versionId: target.versionId!, outcome: 'BLOCKED', reasonCode, message, evidence: [] },
  });
};

describe('flow version delete command', () => {
  const sandbox = sinon.createSandbox();
  const args = ['--target-org', 'source', '--flow', 'Invoice_Approval', '--versions', '2'];
  let plan: FlowVersionDeletePlan;
  let deletion: FlowVersionDeleteExecutionReport;
  let planStub: sinon.SinonStub;
  let execute: sinon.SinonStub;
  let log: sinon.SinonStub;
  let logJson: sinon.SinonStub;
  let logToStderr: sinon.SinonStub;
  let confirm: sinon.SinonStub;
  let createOrg: sinon.SinonStub;
  let getConnection: sinon.SinonStub;
  let originalExitCode: typeof process.exitCode;
  let originalIsTTY: PropertyDescriptor | undefined;
  let originalOutputTTY: PropertyDescriptor | undefined;

  const setInteractive = (interactive: boolean): void => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: interactive });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: interactive });
  };

  const expectError = async (commandArgs: string[], fragment?: string): Promise<Error> => {
    let caught: unknown;
    try {
      await runNormal(commandArgs);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    if (fragment) expect((caught as Error).message).to.include(fragment);
    return caught as Error;
  };

  beforeEach(() => {
    originalExitCode = process.exitCode;
    originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    originalOutputTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    process.exitCode = undefined;
    setInteractive(false);
    plan = planFixture();
    deletion = deletionFixture(plan);
    const ux = stubSfCommandUx(sandbox);
    log = ux.log;
    logJson = ux.logJson;
    logToStderr = ux.logToStderr;
    confirm = sandbox.stub(ConfirmationPrompt.prototype, 'confirm').resolves(false);
    getConnection = sandbox.stub().returns({
      getApiVersion: () => '67.0',
      getAuthInfoFields: () => ({ orgId: '00D000000000001EAA' }),
      tooling: { query: sandbox.stub(), queryMore: sandbox.stub() },
      request: sandbox.stub(),
    });
    createOrg = sandbox.stub(Org, 'create').resolves({
      getConnection,
      getUsername: () => 'poc@example.com',
    } as unknown as Org);
    planStub = sandbox.stub(FlowVersionDeleteService.prototype, 'plan').resolves(plan);
    execute = sandbox.stub(FlowVersionDeleteService.prototype, 'execute').resolves(deletion);
  });

  afterEach(() => {
    sandbox.restore();
    process.exitCode = originalExitCode;
    if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
    if (originalOutputTTY) Object.defineProperty(process.stdout, 'isTTY', originalOutputTTY);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
  });

  it('forwards arbitrary Flow names, namespaces, version expressions and API version without hardcoded selection', async () => {
    plan.flowName = 'Receipt_Reconciliation';
    plan.namespace = 'billing';
    const result = await runNormal([
      '-o',
      'source',
      '-f',
      'Receipt_Reconciliation',
      '--namespace',
      'billing',
      '--versions',
      '2,4-6',
      '--api-version',
      '67.0',
      '--dry-run',
    ]);

    expect(planStub.calledOnce).to.equal(true);
    expect(planStub.firstCall.args.slice(0, 1)).to.deep.equal([
      { flowName: 'Receipt_Reconciliation', namespace: 'billing', versions: '2,4-6' },
    ]);
    expect(getConnection.calledOnceWithExactly('67.0')).to.equal(true);
    expect(result).not.to.have.property('plan');
    expect(String(log.firstCall.args[0])).to.include('Flow: billing__Receipt_Reconciliation');
    expect(execute.called).to.equal(false);
  });

  it('allows a noninteractive dry run without confirmation and sends no mutation', async () => {
    const result = await runNormal([...args, '--dry-run']);

    expect(result).to.deep.equal(projectNormalReport({ ...commandReportFixture(plan), dryRun: true }));
    expect(planStub.firstCall.args[1]).to.deep.equal({ preview: true });
    expect(planStub.calledOnce).to.equal(true);
    expect(confirm.called).to.equal(false);
    expect(execute.called).to.equal(false);
    expect(log.calledOnce).to.equal(true);
    expect(String(log.firstCall.args[0])).to.include('No deletion requests were sent');
    expect(process.exitCode).not.to.equal(1);
  });

  it('returns the full dry-run plan as JSON without a prompt or human output', async () => {
    const result = await runNormal([...args, '--dry-run', '--json']);

    expect(result.results.map((row) => row.versionNumber)).to.deep.equal(plan.versions.map((row) => row.versionNumber));
    expect(result).not.to.have.property('deletion');
    expect(result.outcome).to.equal('previewed');
    expect(result.confirmed).to.equal(false);
    expect(confirm.called).to.equal(false);
    expect(execute.called).to.equal(false);
    expect(log.called).to.equal(false);
    expect(logToStderr.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
  });

  it('automatically previews nonterminal deletion without explicit approval', async () => {
    setInteractive(false);
    const result = await runNormal(args);
    expect(result.dryRun).to.equal(true);
    expect(result.outcome).to.equal('previewed');
    expect(planStub.firstCall.args[1]).to.deep.equal({ preview: true });
    expect(execute.called || confirm.called).to.equal(false);
  });

  it('automatically previews JSON deletion without explicit approval', async () => {
    setInteractive(true);
    const result = await runNormal([...args, '--json']);
    expect(result.dryRun).to.equal(true);
    expect(result.outcome).to.equal('previewed');
    expect(planStub.firstCall.args[1]).to.deep.equal({ preview: true });
    expect(execute.called || confirm.called).to.equal(false);
  });

  it('displays the exact plan before prompting, defaults to no and cancels without mutation', async () => {
    setInteractive(true);
    const result = await runNormal(args);

    expect(result.outcome).to.equal('cancelled');
    expect(result.confirmed).to.equal(false);
    expect(result).not.to.have.property('deletion');
    expect(log.calledBefore(confirm)).to.equal(true);
    expect(String(log.firstCall.args[0])).to.include('v2 | 301xx000003Ga19AAC | Draft');
    expect(confirm.calledOnce).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({ defaultAnswer: false });
    expect((confirm.firstCall.args[0] as { message: string }).message).to.include('1 requested Flow versions');
    expect(execute.called).to.equal(false);
    expect(String(log.lastCall.args[0])).to.include('Deletion cancelled');
  });

  it('maps a real standard-flag confirmation deadline to exit 69', async () => {
    setInteractive(true);
    confirm.rejects(new ConfirmationTimeoutError());

    const result = await runNormal(args);

    expect(confirm.calledOnce).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({ ms: 60_000, defaultAnswer: false });
    expect(result.outcome).to.equal('timed_out');
    expect(result.confirmed).to.equal(false);
    expect(result).not.to.have.property('deletion');
    expect(execute.called).to.equal(false);
    expect(String(log.lastCall.args[0])).to.include('timed out');
    expect(process.exitCode).to.equal(69);
  });

  it('executes the same displayed plan after explicit interactive confirmation', async () => {
    setInteractive(true);
    confirm.resolves(true);
    const result = await runNormal(args);

    expect(execute.calledOnce).to.equal(true);
    expect(execute.firstCall.args[0]).to.equal(plan);
    expect(confirm.calledBefore(execute)).to.equal(true);
    expect(result.confirmed).to.equal(true);
    expect(result.results.map((row) => row.versionNumber)).to.deep.equal(
      deletion.results.map((row) => row.versionNumber)
    );
    expect(result.outcome).to.equal('succeeded');
    expect(log.callCount).to.equal(2);
  });

  it('uses --yes to approve exactly the resolved plan without prompting', async () => {
    const result = await runNormal([...args, '--yes']);

    expect(planStub.calledOnce).to.equal(true);
    expect(confirm.called).to.equal(false);
    expect(execute.calledOnce).to.equal(true);
    expect(execute.firstCall.args[0]).to.equal(plan);
    expect(result).to.deep.equal(
      projectNormalReport({
        ...commandReportFixture(plan),
        confirmed: true,
        outcome: 'SUCCEEDED',
        deletion,
      })
    );
    expect(String(log.firstCall.args[0])).to.include('=== Results');
    expect(String(log.firstCall.args[0])).to.include('v2 | 301xx000003Ga19AAC | DELETED');
    expect(planStub.firstCall.args[1]).to.deep.equal({ preview: false });
  });

  it('returns successful JSON deletion results without human output', async () => {
    const result = await runNormal([...args, '--yes', '--json']);

    expect(result.results.map((row) => row.versionNumber)).to.deep.equal(
      deletion.results.map((row) => row.versionNumber)
    );
    expect(result.confirmed).to.equal(true);
    expect(log.called).to.equal(false);
    expect(logToStderr.called).to.equal(false);
    expect(confirm.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
  });

  it('reports a wholly blocked result accurately despite an inconsistent aggregate SDK label', async () => {
    deletion.outcome = 'PARTIAL';
    deletion.results[0].state = 'BLOCKED';
    deletion.results[0].targetDeleted = false;
    deletion.results[0].source = 'CORE';
    deletion.results[0].coreResult = {
      versionId: deletion.results[0].versionId!,
      outcome: 'BLOCKED',
      reasonCode: 'ACTIVE_VERSION',
      message: 'ACTIVE_VERSION',
      evidence: [],
    };
    deletion.results[0].error = { code: 'ACTIVE_VERSION', message: 'ACTIVE_VERSION' };
    const result = await runNormal([...args, '--yes', '--json']);

    expect(result.outcome).to.equal('blocked');
    expect(result.results[0].blockingReasons[0].code).to.equal('ACTIVE_VERSION');
    expect(result.summary.succeeded).to.equal(0);
    expect(process.exitCode).to.equal(1);
    expect(log.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
    expect(execute.calledOnce).to.equal(true);
  });

  it('uses the public blocked classification in console output when every version is blocked', async () => {
    deletion.outcome = 'FAILED';
    Object.assign(deletion.results[0], {
      state: 'BLOCKED',
      source: 'CORE',
      targetDeleted: false,
      coreResult: {
        versionId: deletion.results[0].versionId!,
        outcome: 'BLOCKED',
        reasonCode: 'ACTIVE_VERSION',
        message: 'The active version cannot be deleted.',
        evidence: [],
      },
      error: { code: 'ACTIVE_VERSION', message: 'The active version cannot be deleted.' },
    });
    const result = await runNormal([...args, '--no-prompt']);
    expect(result.outcome).to.equal('blocked');
    expect(process.exitCode).to.equal(1);
    expect(String(log.lastCall.args[0])).to.include('Outcome: blocked').and.include('| BLOCKED');
    expect(String(log.lastCall.args[0])).not.to.include('Outcome: FAILED');
    expect(result.results[0].blockingReasons[0].code).to.equal('ACTIVE_VERSION');
  });

  it('preserves an unknown SDK outcome in JSON and does not retry execution', async () => {
    deletion.outcome = 'UNKNOWN';
    deletion.results[0].state = 'UNKNOWN';
    deletion.results[0].targetDeleted = null;
    deletion.results[0].source = 'CORE';
    deletion.results[0].coreResult = null;
    deletion.results[0].error = {
      code: 'DELETE_OUTCOME_UNCONFIRMED',
      message: 'The deletion outcome is not confirmed.',
    };
    const result = await runNormal([...args, '--yes', '--json']);

    expect(result.outcome).to.equal('unknown');
    expect(result.results.map((row) => row.versionNumber)).to.deep.equal(
      deletion.results.map((row) => row.versionNumber)
    );
    expect(process.exitCode).to.equal(1);
    expect(execute.calledOnce).to.equal(true);
    expect(log.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
  });

  it('never executes or prompts when list-based target resolution fails', async () => {
    planStub.rejects(new SfError('Unable to list the selected Flow.', 'LIST_REQUEST_FAILED'));
    await expectError([...args, '--yes'], 'Unable to list the selected Flow');

    expect(execute.called).to.equal(false);
    expect(confirm.called).to.equal(false);
  });

  it('does not retry when execution raises an unexpected error', async () => {
    execute.rejects(new SfError('Unable to determine deletion outcome.', 'UnexpectedExecutionError'));
    await expectError([...args, '--yes'], 'Unable to determine deletion outcome');

    expect(execute.calledOnce).to.equal(true);
    expect(confirm.called).to.equal(false);
  });

  it('returns mixed C2 results without dropping blocked versions or later successes', async () => {
    plan.requestedVersions = [1, 2, 3];
    plan.versions = [1, 2, 3].map(targetFixture);
    blockTarget(plan.versions[0], 'HAS_INTERVIEWS', 'HAS_INTERVIEWS (1)');
    blockTarget(plan.versions[1], 'ACTIVE_VERSION');
    deletion = deletionFixture(plan);
    deletion.outcome = 'PARTIAL';
    deletion.results = plan.versions.map((target) =>
      target.assessment?.outcome === 'BLOCKED'
        ? {
            ...target,
            state: 'BLOCKED',
            targetDeleted: false,
            source: 'CORE',
            coreResult: {
              versionId: target.versionId!,
              outcome: 'BLOCKED',
              reasonCode: target.assessment.reasonCode!,
              message: target.assessment.message!,
              evidence: [],
            },
            error: { code: target.assessment.reasonCode!, message: target.assessment.message! },
          }
        : {
            ...target,
            state: 'SUCCEEDED',
            targetDeleted: true,
            source: 'CORE',
            coreResult: {
              versionId: target.versionId!,
              outcome: 'DELETED',
              reasonCode: null,
              message: null,
              evidence: [],
            },
            error: null,
          }
    );
    execute.resolves(deletion);

    const result = await runNormal([
      '-o',
      'source',
      '--flow',
      'Invoice_Approval',
      '--versions',
      '1-3',
      '--yes',
      '--json',
    ]);

    expect(result.results.map((item) => item.outcome)).to.deep.equal(['blocked', 'blocked', 'succeeded']);
    expect(result.results[0].blockingReasons[0].message).to.equal('HAS_INTERVIEWS (1)');
    expect(process.exitCode).to.equal(68);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
    expect(execute.calledOnceWithExactly(plan)).to.equal(true);
    expect(confirm.called).to.equal(false);
  });

  it('retains a missing version as a failed item alongside a successful version', async () => {
    const missing = targetFixture(8);
    Object.assign(missing, {
      versionId: null,
      status: null,
      assessment: null,
      error: { code: 'VERSION_NOT_FOUND', message: 'Version 8 does not exist in this Flow.' },
    });
    plan.requestedVersions = [2, 8];
    plan.versions.push(missing);
    deletion = deletionFixture(plan);
    deletion.outcome = 'PARTIAL';
    Object.assign(deletion.results[1], {
      state: 'FAILED',
      source: 'RESOLUTION',
      coreResult: null,
      targetDeleted: false,
      error: missing.error,
    });
    execute.resolves(deletion);

    const result = await runNormal([...args, '--yes', '--json']);

    expect(result.results.map((item) => item.outcome)).to.deep.equal(['succeeded', 'failed']);
    expect(result.results[1].versionId).to.equal(null);
    expect(process.exitCode).to.equal(68);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('keeps a Core ERROR distinct from a business blocker', async () => {
    const target = plan.versions[0];
    target.assessment = {
      versionId: target.versionId!,
      outcome: 'ERROR',
      reasonCode: 'DELETE_ERROR',
      message: null,
      evidence: [],
    };
    deletion = deletionFixture(plan);
    deletion.outcome = 'FAILED';
    Object.assign(deletion.results[0], {
      state: 'FAILED',
      source: 'CORE',
      targetDeleted: false,
      coreResult: {
        versionId: target.versionId!,
        outcome: 'ERROR',
        reasonCode: 'DELETE_ERROR',
        message: 'The version could not be deleted.',
        evidence: [],
      },
      error: { code: 'DELETE_ERROR', message: 'The version could not be deleted.' },
    });
    execute.resolves(deletion);

    const result = await runNormal([...args, '--yes']);

    expect(process.exitCode).to.equal(1);
    expect(result.results[0].outcome).to.equal('failed');
    expect(String(log.firstCall.args[0])).to.include('DELETE_ERROR');
    expect(String(log.firstCall.args[0])).not.to.include('| BLOCKED');
  });

  it('completes a dry run with blocked and unresolved items without confirmation or deletion', async () => {
    blockTarget(plan.versions[0], 'ACTIVE_VERSION');
    const missing = targetFixture(9);
    Object.assign(missing, {
      versionId: null,
      status: null,
      assessment: null,
      error: { code: 'VERSION_NOT_FOUND', message: 'Version 9 is missing.' },
    });
    plan.requestedVersions.push(9);
    plan.versions.push(missing);

    const result = await runNormal([...args, '--dry-run', '--json']);

    expect(result.results[0].action).to.equal('blocked');
    expect(result.results[1].versionId).to.equal(null);
    expect(result.outcome).to.equal('previewed');
    expect(process.exitCode).to.equal(0);
    expect(execute.called).to.equal(false);
    expect(confirm.called).to.equal(false);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('gives failed results precedence over blocked results for the process exit code', async () => {
    plan.requestedVersions = [1, 2];
    plan.versions = [1, 2].map(targetFixture);
    deletion = deletionFixture(plan);
    deletion.outcome = 'FAILED';
    Object.assign(deletion.results[0], {
      state: 'BLOCKED',
      source: 'CORE',
      targetDeleted: false,
      coreResult: {
        versionId: deletion.results[0].versionId!,
        outcome: 'BLOCKED',
        reasonCode: 'ACTIVE_VERSION',
        message: 'ACTIVE_VERSION',
        evidence: [],
      },
      error: { code: 'ACTIVE_VERSION', message: 'ACTIVE_VERSION' },
    });
    Object.assign(deletion.results[1], {
      state: 'FAILED',
      source: 'CORE',
      targetDeleted: false,
      coreResult: {
        versionId: deletion.results[1].versionId!,
        outcome: 'ERROR',
        reasonCode: 'DELETE_ERROR',
        message: 'The platform rejected deletion.',
        evidence: [],
      },
      error: { code: 'DELETE_ERROR', message: 'The platform rejected deletion.' },
    });
    execute.resolves(deletion);

    const result = await runNormal([...args, '--yes', '--json']);

    expect(process.exitCode).to.equal(1);
    expect(result.results.map((item) => item.outcome)).to.deep.equal(['blocked', 'failed']);
  });

  it('preserves unknown and not-attempted items rather than claiming a confirmed failure', async () => {
    plan.requestedVersions = [1, 2];
    plan.versions = [1, 2].map(targetFixture);
    deletion = deletionFixture(plan);
    deletion.outcome = 'UNKNOWN';
    Object.assign(deletion.results[0], {
      state: 'UNKNOWN',
      coreResult: null,
      source: 'CORE',
      targetDeleted: null,
      error: { code: 'DELETE_OUTCOME_UNCONFIRMED', message: 'The response was lost.' },
    });
    Object.assign(deletion.results[1], {
      state: 'NOT_ATTEMPTED',
      coreResult: null,
      source: 'SAFETY',
      targetDeleted: null,
      error: { code: 'EXECUTION_STOPPED', message: 'An earlier outcome needs reconciliation.' },
    });
    execute.resolves(deletion);

    const result = await runNormal([...args, '--yes', '--json']);

    expect(process.exitCode).to.equal(1);
    expect(result.results.map((item) => item.outcome)).to.deep.equal(['unknown', 'not_attempted']);
    expect(execute.calledOnce).to.equal(true);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('maps SDK errors to typed Salesforce CLI errors', async () => {
    planStub.rejects(new FlowVersionError('ASSESSMENT_API_VERSION_UNSUPPORTED', 'API 67.0 or later is required.'));

    const error = await expectError([...args, '--dry-run'], 'API 67.0');

    expect(error).to.be.instanceOf(SfError);
    expect((error as SfError).code).to.equal('ASSESSMENT_API_VERSION_UNSUPPORTED');
    expect(execute.called).to.equal(false);
  });

  for (const code of ['INVALID_IDENTIFIER', 'INVALID_SELECTION', 'SELECTION_TOO_LARGE']) {
    it(`maps genuine input validation ${code} to usage exit 2`, async () => {
      planStub.rejects(new FlowVersionError(code, 'Correct the explicit Flow/version selection.'));
      const failure = await expectError([...args, '--dry-run'], 'Correct the explicit');
      expect((failure as SfError).exitCode).to.equal(2);
      expect(execute.called).to.equal(false);
    });
  }

  it('keeps a malformed backend inventory as runtime error 1 rather than invalid usage', async () => {
    planStub.rejects(new FlowVersionError('INVALID_INVENTORY', 'The server returned an invalid inventory.'));
    const failure = await expectError([...args, '--dry-run'], 'invalid inventory');
    expect((failure as SfError).exitCode).to.equal(1);
    expect(execute.called).to.equal(false);
  });

  it('does not route headless force execution through normal planning or mutation', async () => {
    await expectError([...args, '--yes', '--force'], 'interactive input and output');

    expect(planStub.called).to.equal(false);
    expect(execute.called).to.equal(false);
  });

  it('requires an explicit Flow name and explicit version selection', async () => {
    await expectError(['-o', 'source', '--versions', '2', '--dry-run'], 'flow');
    await expectError(['-o', 'source', '--flow', 'Invoice_Approval', '--dry-run'], 'versions');

    expect(planStub.called).to.equal(false);
    expect(execute.called).to.equal(false);
  });

  describe('bare named arguments', () => {
    const bareArgs = ['target-org', 'source', 'flow', 'Invoice_Approval', 'versions', '2'];

    it('passes the same requested Flow and comma-separated versions as standard flags', async () => {
      const bareResult = await runNormal(['target-org', 'source', 'flow', 'MyFlow1', 'versions', '1,2,3', '--dry-run']);
      const flaggedResult = await runNormal([
        '--target-org',
        'source',
        '--flow',
        'MyFlow1',
        '--versions',
        '1,2,3',
        '--dry-run',
      ]);

      expect(planStub.callCount).to.equal(2);
      for (const call of planStub.getCalls()) {
        expect(call.args.slice(0, 1)).to.deep.equal([{ flowName: 'MyFlow1', versions: '1,2,3', namespace: undefined }]);
      }
      expect(createOrg.calledWithExactly({ aliasOrUsername: 'source' })).to.equal(true);
      expect(bareResult).to.deep.equal(flaggedResult);
      expect(bareResult.dryRun).to.equal(true);
      expect(bareResult.outcome).to.equal('previewed');
      expect(confirm.called).to.equal(false);
      expect(execute.called).to.equal(false);
    });

    it('preserves native --dry-run and --json behavior without human output or confirmation', async () => {
      const result = await runNormal(['--json', ...bareArgs, '--dry-run']);

      expect(result).to.deep.equal(projectNormalReport({ ...commandReportFixture(plan), dryRun: true }));
      expect(planStub.calledOnce).to.equal(true);
      expect(confirm.called).to.equal(false);
      expect(execute.called).to.equal(false);
      expect(log.called).to.equal(false);
      expect(logToStderr.called).to.equal(false);
      expect(logJson.calledOnce).to.equal(true);
    });

    it('routes spaced command words and bare pairs through the actual CLI without deleting', async () => {
      const result = await runCli(['flow', 'version', 'delete', ...bareArgs, '--dry-run', '--json'], {
        root: fileURLToPath(new URL('../../../../', import.meta.url)),
        devPlugins: false,
        userPlugins: false,
      });

      expect(result).to.deep.equal(projectNormalReport({ ...commandReportFixture(plan), dryRun: true }));
      expect(planStub.calledOnceWith({ flowName: 'Invoice_Approval', versions: '2', namespace: undefined })).to.equal(
        true
      );
      expect(confirm.called).to.equal(false);
      expect(execute.called).to.equal(false);
      expect(log.called).to.equal(false);
      expect(logToStderr.called).to.equal(false);
      expect(logJson.calledOnce).to.equal(true);
    });

    it('forwards bare namespace and API-version values alongside the required pairs', async () => {
      await runNormal([...bareArgs, 'namespace', 'billing', 'api-version', '67.0', '--dry-run']);

      expect(planStub.calledOnceWith({ flowName: 'Invoice_Approval', versions: '2', namespace: 'billing' })).to.equal(
        true
      );
      expect(getConnection.calledOnceWithExactly('67.0')).to.equal(true);
      expect(execute.called).to.equal(false);
    });

    it('automatically previews nonterminal deletion without explicit approval', async () => {
      setInteractive(false);
      const result = await runNormal(bareArgs);
      expect(result.dryRun).to.equal(true);
      expect(result.outcome).to.equal('previewed');
      expect(planStub.firstCall.args[1]).to.deep.equal({ preview: true });
      expect(execute.called || confirm.called).to.equal(false);
    });

    it('automatically previews JSON deletion without explicit approval', async () => {
      setInteractive(true);
      const result = await runNormal([...bareArgs, '--json']);
      expect(result.dryRun).to.equal(true);
      expect(result.outcome).to.equal('previewed');
      expect(planStub.firstCall.args[1]).to.deep.equal({ preview: true });
      expect(execute.called || confirm.called).to.equal(false);
    });

    it('shows the exact plan, defaults interactive confirmation to no and cancels without execution', async () => {
      setInteractive(true);
      const result = await runNormal(bareArgs);

      expect(planStub.firstCall.args.slice(0, 1)).to.deep.equal([
        { flowName: 'Invoice_Approval', versions: '2', namespace: undefined },
      ]);
      expect(result.outcome).to.equal('cancelled');
      expect(result.confirmed).to.equal(false);
      expect(result).not.to.have.property('deletion');
      expect(log.calledBefore(confirm)).to.equal(true);
      expect(String(log.firstCall.args[0])).to.include('v2 | 301xx000003Ga19AAC | Draft');
      expect(confirm.calledOnce).to.equal(true);
      expect(confirm.firstCall.args[0]).to.include({ defaultAnswer: false });
      expect((confirm.firstCall.args[0] as { message: string }).message).to.include('1 requested Flow versions');
      expect(execute.called).to.equal(false);
    });

    it('maps a real bare-pair confirmation deadline to exit 69', async () => {
      setInteractive(true);
      confirm.rejects(new ConfirmationTimeoutError());

      const result = await runNormal(bareArgs);

      expect(confirm.calledOnce).to.equal(true);
      expect(confirm.firstCall.args[0]).to.include({ ms: 60_000, defaultAnswer: false });
      expect(result.outcome).to.equal('timed_out');
      expect(result.confirmed).to.equal(false);
      expect(result).not.to.have.property('deletion');
      expect(execute.called).to.equal(false);
      expect(String(log.lastCall.args[0])).to.include('timed out');
      expect(process.exitCode).to.equal(69);
    });

    it('executes the same displayed plan after explicit interactive confirmation', async () => {
      setInteractive(true);
      confirm.resolves(true);
      const result = await runNormal(bareArgs);

      expect(result).not.to.have.property('plan');
      expect(log.calledBefore(confirm)).to.equal(true);
      expect(confirm.calledBefore(execute)).to.equal(true);
      expect(execute.calledOnceWithExactly(plan)).to.equal(true);
      expect(result.confirmed).to.equal(true);
      expect(result.results.map((row) => row.versionNumber)).to.deep.equal(
        deletion.results.map((row) => row.versionNumber)
      );
      expect(result.outcome).to.equal('succeeded');
    });

    it('uses native --yes and --json to execute exactly the resolved plan without prompting', async () => {
      const result = await runNormal([...bareArgs, '--yes', '--json']);

      expect(result).to.deep.equal(
        projectNormalReport({
          ...commandReportFixture(plan),
          confirmed: true,
          outcome: 'SUCCEEDED',
          deletion,
        })
      );
      expect(planStub.calledOnce).to.equal(true);
      expect(execute.calledOnceWithExactly(plan)).to.equal(true);
      expect(confirm.called).to.equal(false);
      expect(log.called).to.equal(false);
      expect(logToStderr.called).to.equal(false);
      expect(logJson.calledOnce).to.equal(true);
    });

    for (const commandArgs of [
      ['--target-org', 'source', 'flow', 'Invoice_Approval', '--versions', '2'],
      ['target-org', 'source', '-f', 'Invoice_Approval', 'versions', '2'],
      ['versions', '2', '--flow=Invoice_Approval', 'target-org', 'source'],
    ]) {
      it(`accepts mixed standard flags and bare pairs: ${commandArgs.join(' ')}`, async () => {
        const result = await runNormal([...commandArgs, '--yes']);

        expect(planStub.calledOnceWith({ flowName: 'Invoice_Approval', versions: '2', namespace: undefined })).to.equal(
          true
        );
        expect(createOrg.calledWithExactly({ aliasOrUsername: 'source' })).to.equal(true);
        expect(execute.calledOnceWithExactly(plan)).to.equal(true);
        expect(result.outcome).to.equal('succeeded');
      });
    }

    for (const value of ['flow', 'versions', 'target-org']) {
      it(`preserves ${value} as a value in bare pairs`, async () => {
        await runNormal(['target-org', value, 'flow', value, 'versions', value, '--dry-run']);

        expect(createOrg.calledWithExactly({ aliasOrUsername: value })).to.equal(true);
        expect(planStub.calledOnceWith({ flowName: value, versions: value, namespace: undefined })).to.equal(true);
        expect(execute.called).to.equal(false);
      });

      it(`preserves ${value} as a standard flag value beside bare pairs`, async () => {
        await runNormal(['--target-org', value, '--flow', value, 'versions', value, '--dry-run']);

        expect(createOrg.calledWithExactly({ aliasOrUsername: value })).to.equal(true);
        expect(planStub.calledOnceWith({ flowName: value, versions: value, namespace: undefined })).to.equal(true);
        expect(execute.called).to.equal(false);
      });
    }

    for (const commandArgs of [
      ['-o', 'source', '-f', 'Invoice_Approval', '--versions=2'],
      ['--target-org=source', '--flow=Invoice_Approval', '--versions=2'],
      ['-osource', '-fInvoice_Approval', '--versions', '2'],
    ]) {
      it(`preserves standard shorthand and equals flags: ${commandArgs.join(' ')}`, async () => {
        const result = await runNormal([...commandArgs, '-y']);

        expect(createOrg.calledWithExactly({ aliasOrUsername: 'source' })).to.equal(true);
        expect(planStub.calledOnceWith({ flowName: 'Invoice_Approval', versions: '2', namespace: undefined })).to.equal(
          true
        );
        expect(execute.calledOnceWithExactly(plan)).to.equal(true);
        expect(confirm.called).to.equal(false);
        expect(result.confirmed).to.equal(true);
      });
    }

    it('preserves key-like values consumed by short flags and the standard versions flag', async () => {
      await runNormal(['-o', 'flow', '-f', 'versions', '--versions', 'target-org', '--dry-run']);

      expect(createOrg.calledWithExactly({ aliasOrUsername: 'flow' })).to.equal(true);
      expect(planStub.calledOnceWith({ flowName: 'versions', versions: 'target-org', namespace: undefined })).to.equal(
        true
      );
      expect(execute.called).to.equal(false);
    });

    const malformedCases = [
      { name: 'a missing bare value', commandArgs: ['target-org', 'source', 'flow', 'Invoice_Approval', 'versions'] },
      {
        name: 'a standard flag in place of a bare value',
        commandArgs: ['target-org', 'source', 'flow', '--versions', '2'],
      },
      {
        name: 'a boolean flag in place of a bare value',
        commandArgs: ['target-org', 'source', 'flow', 'Invoice_Approval', 'versions', '--dry-run'],
      },
      { name: 'an unknown bare pair', commandArgs: [...bareArgs, 'unexpected', 'value'] },
      { name: 'unlabelled positional values', commandArgs: ['source', 'Invoice_Approval', '2'] },
      {
        name: 'a bare equals expression',
        commandArgs: ['target-org', 'source', 'flow', 'Invoice_Approval', 'versions=2'],
      },
      { name: 'bare pairs after the end-of-options separator', commandArgs: ['--', ...bareArgs] },
    ];

    for (const { name, commandArgs } of malformedCases) {
      it(`rejects ${name} without executing`, async () => {
        await expectError(['--yes', ...commandArgs]);

        expect(execute.called).to.equal(false);
        expect(confirm.called).to.equal(false);
      });
    }

    for (const token of ['yes', 'dry-run', 'json', 'help']) {
      it(`does not treat bare ${token} as a boolean flag alias`, async () => {
        await expectError([...bareArgs, '--yes', token]);

        expect(planStub.called).to.equal(false);
        expect(execute.called).to.equal(false);
        expect(confirm.called).to.equal(false);
      });
    }

    const duplicateCases = [
      { name: 'bare Flow pairs', commandArgs: [...bareArgs, 'flow', 'Another_Flow'] },
      { name: 'bare target-org pairs', commandArgs: [...bareArgs, 'target-org', 'other'] },
      { name: 'a bare Flow pair and --flow', commandArgs: [...bareArgs, '--flow', 'Another_Flow'] },
      { name: '--flow and a bare Flow pair', commandArgs: [...args, 'flow', 'Another_Flow'] },
      { name: 'a bare Flow pair and -f', commandArgs: [...bareArgs, '-f', 'Another_Flow'] },
      { name: 'a bare Flow pair and --flow=', commandArgs: [...bareArgs, '--flow=Another_Flow'] },
      { name: 'a bare target-org pair and -o', commandArgs: [...bareArgs, '-o', 'other'] },
      { name: 'standard --flow flags', commandArgs: [...args, '--flow', 'Another_Flow'] },
      { name: '--flow and -f', commandArgs: [...args, '-f', 'Another_Flow'] },
      { name: 'standard --target-org flags', commandArgs: [...args, '--target-org=other'] },
      { name: 'standard namespace flags', commandArgs: [...args, '--namespace', 'billing', '--namespace=other'] },
      { name: 'standard API-version flags', commandArgs: [...args, '--api-version', '67.0', '--api-version=66.0'] },
    ];

    for (const { name, commandArgs } of duplicateCases) {
      it(`rejects duplicate singleton options expressed as ${name} before planning or execution`, async () => {
        await expectError([...commandArgs, '--yes']);

        expect(planStub.called).to.equal(false);
        expect(execute.called).to.equal(false);
        expect(confirm.called).to.equal(false);
      });
    }
  });

  for (const values of [
    ['--versions', '3', '--versions', '4', '--versions', '7-12'],
    ['versions', '3,4', '--versions', '7-12'],
  ]) {
    it(`accepts repeated version values without absorbing following bare pairs: ${values.join(' ')}`, async () => {
      const result = await runNormal([...values, 'flow', 'Invoice_Approval', 'target-org', 'source', '--dry-run']);
      expect(planStub.firstCall.args[0]).to.include({ versions: '3,4,7-12', flowName: 'Invoice_Approval' });
      expect(result.dryRun).to.equal(true);
      expect(execute.called).to.equal(false);
    });
  }

  for (const approval of ['--no-prompt', '-p', '--yes', '-y']) {
    it(`explicit approval ${approval} authorizes JSON mutation without prompting`, async () => {
      const result = await runNormal([...args, approval, '--json']);
      expect(execute.calledOnceWithExactly(plan)).to.equal(true);
      expect(confirm.called).to.equal(false);
      expect(result.summary.succeeded).to.equal(1);
      expect(process.exitCode).to.equal(0);
    });
  }

  it('keeps explicit dry run read-only even with noninteractive approval', async () => {
    const result = await runNormal([...args, '--no-prompt', '--dry-run', '--json']);
    expect(planStub.firstCall.args[1]).to.deep.equal({ preview: true });
    expect(result.dryRun).to.equal(true);
    expect(execute.called || confirm.called).to.equal(false);
  });

  it('preserves key-like values after combined compatibility short flags', async () => {
    await runNormal(['-yo', 'flow', 'flow', 'Invoice_Approval', 'versions', '2']);
    expect(createOrg.calledWithExactly({ aliasOrUsername: 'flow' })).to.equal(true);
    expect(planStub.firstCall.args[0]).to.include({ flowName: 'Invoice_Approval', versions: '2' });
    expect(execute.calledOnce).to.equal(true);
  });

  it('formats the selected versions with readable sections and one surrounding blank line', () => {
    const output = formatVersionDeleteReport(commandReportFixture(plan));

    expect(output).to.equal(
      [
        '',
        '=== Flow version deletion',
        'Target org: poc@example.com | API: 67.0 | Mode: NORMAL',
        'Flow: Invoice_Approval',
        'Definition: 300xx000000bojNAAQ',
        '',
        '=== Selected versions',
        '  v2 | 301xx000003Ga19AAC | Draft | PASS',
        '',
        'Outcome: PREVIEWED',
        'Warning: Client selection checks are not atomic.',
        '',
      ].join('\n')
    );
    expect(output.startsWith('\n\n')).to.equal(false);
    expect(output.endsWith('\n\n')).to.equal(false);
  });

  it('sanitizes control characters in selected-version text without modifying the structured report', () => {
    const report = commandReportFixture(plan);
    report.targetOrg = 'poc\nspoof@example.com';
    report.apiVersion = '67.0\r';
    plan.flowName = 'Invoice\tApproval';
    plan.namespace = 'billing\u001b';
    plan.definitionId = '300\nspoof';
    plan.versions[0].versionId = '301\nspoof';
    plan.versions[0].status = 'Draft\u0007';
    plan.warnings = ['Warning\nspoof'];
    const output = formatVersionDeleteReport(report);

    expect(output).to.include('Target org: poc spoof@example.com | API: 67.0  | Mode: NORMAL');
    expect(output).to.include('Flow: billing __Invoice Approval');
    expect(output).to.include('Definition: 300 spoof');
    expect(output).to.include('v2 | 301 spoof | Draft ');
    expect(output).to.include('Warning: Warning spoof');
    for (const control of ['\r', '\t', '\u0007', '\u001b']) expect(output).not.to.include(control);
    expect(report.targetOrg).to.equal('poc\nspoof@example.com');
    expect(plan.versions[0].versionId).to.equal('301\nspoof');
  });

  it('renders per-version errors and execution warnings instead of preview warnings', () => {
    const report = commandReportFixture(plan);
    deletion.results[0].state = 'FAILED';
    deletion.results[0].targetDeleted = false;
    deletion.results[0].coreResult = null;
    deletion.results[0].source = 'RESOLUTION';
    deletion.results[0].error = { code: 'RESOLUTION\nERROR', message: 'Target\ncould not be resolved.' };
    deletion.warnings = ['Not an atomic\nbatch.'];
    report.deletion = deletion;
    report.outcome = deletion.outcome;
    report.confirmed = true;
    const output = formatVersionDeleteReport(report);

    expect(output).to.include('=== Results');
    expect(output).to.include('RESOLUTION ERROR: Target could not be resolved.');
    expect(output).to.include('Warning: Not an atomic batch.');
    expect(output).not.to.include('Client selection checks are not atomic.');
    expect(output).not.to.include('=== Selected versions');
  });

  it('renders Core preview reason and message without reading legacy interview evidence', () => {
    const report = commandReportFixture(plan);
    blockTarget(plan.versions[0], 'HAS_INTERVIEWS', 'HAS_INTERVIEWS (1); FUTURE_BACKEND_REASON');
    plan.versions[0].assessment!.evidence = [
      {
        sourceId: '0Fo000000000001CAA',
        sourceType: 'FlowInterview',
        sourceName: 'Hidden interview name',
        targetKind: 'VERSION',
        targetId: plan.versions[0].versionId!,
        targetName: null,
        channels: ['SETUP_RESTRICT'],
        interviewRoles: ['PERSISTED_REFERENCE'],
        detailsRedacted: true,
      },
    ];

    const output = formatVersionDeleteReport(report);

    expect(output).to.include('HAS_INTERVIEWS (1); FUTURE_BACKEND_REASON');
    expect(output).not.to.include('Reference:');
    expect(output).not.to.include('0Fo000000000001CAA');
    expect(output).not.to.include('Hidden interview name');
    expect(plan.versions[0].assessment!.evidence[0].sourceName).to.equal('Hidden interview name');
  });

  it('renders Core LAST_VERSION as the backend blocker', () => {
    const report = commandReportFixture(plan);
    report.deletion = deletion;
    report.outcome = 'FAILED';
    Object.assign(deletion.results[0], {
      state: 'BLOCKED',
      source: 'CORE',
      targetDeleted: false,
      coreResult: {
        versionId: deletion.results[0].versionId!,
        outcome: 'BLOCKED',
        reasonCode: 'LAST_VERSION',
        message: 'The last remaining version cannot be deleted.',
        evidence: [],
      },
      error: { code: 'LAST_VERSION', message: 'The last remaining version cannot be deleted.' },
    });
    const output = formatVersionDeleteReport(report);
    expect(output).to.include('| BLOCKED');
    expect(output).to.include('LAST_VERSION: The last remaining version cannot be deleted.');
    expect(output).not.to.include('Client policy');
  });

  it('preserves ALREADY_DELETED as successful Core output and exits successfully', async () => {
    Object.assign(deletion.results[0], {
      coreResult: {
        versionId: deletion.results[0].versionId!,
        outcome: 'DELETED',
        reasonCode: 'ALREADY_DELETED',
        message: 'This version is already deleted.',
        evidence: [],
      },
    });
    const result = await runNormal([...args, '--yes']);
    expect(result.results[0].outcome).to.equal('succeeded');
    expect(result.results[0].reasonCode).to.equal('ALREADY_DELETED');
    expect(result.summary.succeeded).to.equal(1);
    expect(String(log.firstCall.args[0])).to.include('| DELETED');
    expect(String(log.firstCall.args[0])).to.include('ALREADY_DELETED: This version is already deleted.');
    expect(process.exitCode).to.equal(0);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
    expect(execute.calledOnce).to.equal(true);
  });

  it('removes ANSI and bidirectional controls from human output without changing JSON data', () => {
    const report = commandReportFixture(plan);
    report.targetOrg = '\u001b[31morg\u001b[0m\u202E@example.invalid';
    blockTarget(plan.versions[0], 'FUTURE_REASON', 'Before\u001b]0;title\u0007after\u200Bcontrol');

    const output = formatVersionDeleteReport(report);

    expect(output).not.to.include('\u001b');
    expect(output).not.to.include('\u202E');
    expect(output).not.to.include('\u200B');
    expect(output).to.include('org @example.invalid');
    expect(output).to.include('Beforeafter control');
    expect(report.targetOrg).to.include('\u001b');
  });

  it('validates public preview, cancelled and execution reports against the command schema', () => {
    const preview = commandReportFixture(plan);
    const cancelled: FlowVersionDeleteCommandReport = { ...preview, outcome: 'CANCELLED' };
    const executed: FlowVersionDeleteCommandReport = { ...preview, confirmed: true, outcome: 'SUCCEEDED', deletion };
    for (const internal of [preview, cancelled, executed]) {
      const report = projectNormalReport(internal);
      expect(validateReport(report), JSON.stringify(validateReport.errors)).to.equal(true);
      expect(report).not.to.have.property('plan');
      expect(report).not.to.have.property('deletion');
    }
  });

  it('rejects obsolete public contracts, invalid outcomes and unexpected properties', () => {
    const preview = projectNormalReport(commandReportFixture(plan));
    expect(validateReport({ ...preview, contractVersion: '1' })).to.equal(false);
    expect(validateReport({ ...preview, outcome: 'DELETED' })).to.equal(false);
    expect(validateReport({ ...preview, fabricatedBlockers: [] })).to.equal(false);
  });
});
