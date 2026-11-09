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
import { FlowVersionError } from '@salesforce/flow-node';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import FlowVersionPrune, {
  formatVersionPruneReport,
  type FlowVersionPruneCommandReport,
} from '../../../../src/commands/flow/version/prune.js';
import {
  FlowVersionRetentionService,
  type RetentionPlan,
  type RetentionExecution,
} from '../../../../src/services/flowVersionRetention.js';
import { ConfirmationPrompt } from '../../../../src/ux/confirmation.js';
import { ConfirmationTimeoutError } from '../../../../src/ux/confirmationTimeout.js';

const validateReport = new Ajv({ allErrors: true }).compile(
  JSON.parse(readFileSync(new URL('../../../../schemas/flow-version-prune.json', import.meta.url), 'utf8')) as object
);
const fixture = (): RetentionPlan => ({
  orgId: '00D000000000001EAA',
  generatedAt: '2026-10-27T00:00:00Z',
  scope: { all: false, flowName: 'Invoice', namespace: null, allNamespaces: true },
  policy: { keepLatest: 5, olderThanDays: 90 },
  flows: [
    {
      definitionId: '300xx000000bojNAAQ',
      apiName: 'Invoice',
      label: 'Invoice',
      versionCount: 6,
      limitPercent: 12,
      versions: [
        {
          versionId: '301xx000003Ga19AAC',
          versionNumber: 1,
          versionName: null,
          status: 'Draft',
          createdDate: '2026-01-01T00:00:00Z',
          ageDays: 299,
          createdById: null,
          createdByName: null,
          lastModifiedDate: null,
          statusChangeDate: null,
          referenceCount: 0,
          pausedInterviewCount: 0,
          failedInterviewCount: 0,
          deletable: true,
          outcome: 'PASS',
          reasonCode: null,
          message: null,
          disposition: 'CANDIDATE',
          reasons: [{ code: 'RETENTION_CANDIDATE', message: 'Meets retention policy.' }],
        },
      ],
    },
  ],
});
const execution = (plan: RetentionPlan): RetentionExecution => ({
  outcome: 'SUCCEEDED',
  warnings: [],
  results: plan.flows[0].versions.map((row) => ({
    definitionId: plan.flows[0].definitionId,
    versionId: row.versionId,
    flowName: plan.flows[0].apiName,
    namespace: null,
    versionNumber: row.versionNumber,
    status: row.status,
    assessment: null,
    error: null,
    state: 'SUCCEEDED',
    targetDeleted: true,
    source: 'CORE',
    coreResult: { versionId: row.versionId, outcome: 'DELETED', reasonCode: null, message: null, evidence: [] },
  })),
});

const internalReport = (
  plan: RetentionPlan,
  deletion: RetentionExecution | null = null
): FlowVersionPruneCommandReport => ({
  contractVersion: '1',
  mode: 'RETENTION',
  targetOrg: 'unit@example.com',
  apiVersion: '67.0',
  dryRun: deletion === null,
  confirmed: deletion !== null,
  outcome: deletion?.outcome ?? 'PREVIEWED',
  plan,
  deletion,
});

describe('flow version prune command', () => {
  const sandbox = sinon.createSandbox();
  const args = ['--target-org', 'source', '--flow', 'Invoice'];
  let plan: RetentionPlan;
  let deletion: RetentionExecution;
  let planStub: sinon.SinonStub;
  let execute: sinon.SinonStub;
  let confirm: sinon.SinonStub;
  let log: sinon.SinonStub;
  let logJson: sinon.SinonStub;
  let getConnection: sinon.SinonStub;
  let originalExitCode: typeof process.exitCode;
  let originalInputTTY: PropertyDescriptor | undefined;
  let originalOutputTTY: PropertyDescriptor | undefined;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const;
  let originalSignalListeners: Map<(typeof signals)[number], NodeJS.SignalsListener[]>;
  const interactive = (input: boolean, output = input): void => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: input });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: output });
  };
  const error = async (commandArgs: string[]): Promise<Error & { exitCode?: number }> => {
    let caught: unknown;
    try {
      await FlowVersionPrune.run(commandArgs);
    } catch (item) {
      caught = item;
    }
    expect(caught).to.be.instanceOf(Error);
    return caught as Error & { exitCode?: number };
  };

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    originalInputTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    originalOutputTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    originalSignalListeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
    interactive(false);
    plan = fixture();
    deletion = execution(plan);
    ({ log, logJson } = stubSfCommandUx(sandbox));
    confirm = sandbox.stub(ConfirmationPrompt.prototype, 'confirm').resolves(false);
    getConnection = sandbox.stub().returns({ getApiVersion: () => '67.0' });
    sandbox.stub(Org, 'create').resolves({
      getConnection,
      getUsername: () => 'unit@example.com',
    } as unknown as Org);
    planStub = sandbox.stub(FlowVersionRetentionService.prototype, 'plan').resolves(plan);
    execute = sandbox.stub(FlowVersionRetentionService.prototype, 'execute').resolves(deletion);
  });
  afterEach(() => {
    sandbox.restore();
    process.exitCode = originalExitCode;
    if (originalInputTTY) Object.defineProperty(process.stdin, 'isTTY', originalInputTTY);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
    if (originalOutputTTY) Object.defineProperty(process.stdout, 'isTTY', originalOutputTTY);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
    // Static command runs install framework signal listeners; keep each test's process state isolated.
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!originalSignalListeners.get(signal)?.includes(listener)) process.removeListener(signal, listener);
      }
    }
  });

  it('defaults to preview with PRD defaults and performs no confirmation or execution', async () => {
    const result = await FlowVersionPrune.run(args);
    expect(planStub.firstCall.args).to.deep.equal([{ flowName: 'Invoice' }, { keepLatest: 5, olderThanDays: 90 }]);
    expect(result).to.include({ contractVersion: '3', dryRun: true, confirmed: false, outcome: 'previewed' });
    expect(result).not.to.have.any.keys('plan', 'deletion');
    expect(result.summary).to.include({ succeeded: 0, wouldDelete: 1 });
    expect(result.results[0]).to.include({ action: 'delete', outcome: null, versionNumber: 1 });
    expect(confirm.called || execute.called).to.equal(false);
    expect(String(log.firstCall.args[0])).to.include('No deletion requests were sent.');
    expect(process.exitCode).to.equal(0);
  });

  it('keeps default preview even in an interactive terminal', async () => {
    interactive(true);
    const result = await FlowVersionPrune.run(args);
    expect(result.dryRun).to.equal(true);
    expect(confirm.called || execute.called).to.equal(false);
  });

  it('returns JSON preview without human output even in noninteractive mode', async () => {
    const result = await FlowVersionPrune.run([...args, '--dry-run', '--json']);
    expect(result.dryRun).to.equal(true);
    expect(confirm.called || execute.called || log.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('passes arbitrary scope and configurable retention without prefiltering C1', async () => {
    await FlowVersionPrune.run(['-o', 'source', '--all', '--keep-latest', '7', '--older-than', '45d']);
    expect(planStub.firstCall.args).to.deep.equal([{ all: true }, { keepLatest: 7, olderThanDays: 45 }]);
  });

  it('uses the installed C1 client and consumes later pages before protecting latest and rollback versions', async () => {
    planStub.restore();
    const base = fixture().flows[0].versions[0];
    const makeRow = (n: number, status: string, changed: string | null): object => {
      const wire = structuredClone(base) as Partial<typeof base>;
      delete wire.disposition;
      delete wire.reasons;
      return { ...wire, versionId: `30100000000000${n}AAA`, versionNumber: n, status, statusChangeDate: changed };
    };
    const page = (versions: object[], nextOffset: number | null): object => ({
      contractVersion: '1',
      versionLimit: 50,
      returnedVersionCount: versions.length,
      candidateVersionCount: 4,
      listTruncated: false,
      nextOffset,
      flows: [
        {
          definitionId: '300xx000000bojNAAQ',
          apiName: 'Invoice',
          label: 'Invoice',
          versionCount: 4,
          limitPercent: 8,
          versions,
        },
      ],
    });
    const request = sandbox.stub();
    request
      .onFirstCall()
      .resolves(page([makeRow(1, 'Obsolete', '2026-02-01T00:00:00Z'), makeRow(2, 'Draft', null)], 100));
    request
      .onSecondCall()
      .resolves(page([makeRow(3, 'Obsolete', '2026-03-01T00:00:00Z'), makeRow(4, 'Draft', null)], null));
    getConnection.returns({
      getApiVersion: () => '67.0',
      getAuthInfoFields: () => ({ orgId: '00D000000000001EAA' }),
      request,
    });
    const result = await FlowVersionPrune.run([...args, '--keep-latest', '1', '--older-than', '0d', '--json']);
    expect(request.callCount).to.equal(2);
    expect(result.results.map((item) => item.action)).to.deep.equal(['delete', 'delete', 'keep', 'keep']);
    expect(result.summary).to.include({ kept: 2, wouldDelete: 2, succeeded: 0 });
    for (const call of request.getCalls()) {
      const req = call.args[0] as { method: string; url: string; body: string };
      const body = JSON.parse(req.body) as Record<string, unknown>;
      expect(req).to.include({ method: 'POST', url: '/connect/interaction/flow-versions/list' });
      expect(body).not.to.have.any.keys('status', 'olderThanDays', 'deletable');
    }
    expect(JSON.parse((request.secondCall.args[0] as { body: string }).body)).to.include({ offset: 100 });
    expect(execute.called || confirm.called).to.equal(false);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('requires exactly one scope before planning', async () => {
    expect((await error(['-o', 'source'])).exitCode).to.equal(2);
    await error([...args, '--all']);
    expect(planStub.called || execute.called).to.equal(false);
  });

  it('classifies invalid retention values as usage errors before planning', async () => {
    expect((await error([...args, '--keep-latest', '0'])).exitCode).to.equal(2);
    expect((await error([...args, '--older-than', '90'])).exitCode).to.equal(2);
    expect(planStub.called).to.equal(false);
  });

  it('does not classify a runtime inventory error as invalid usage', async () => {
    planStub.rejects(new FlowVersionError('INVALID_INVENTORY', 'The returned inventory is incomplete.'));
    expect((await error(args)).exitCode).to.equal(1);
    expect(execute.called).to.equal(false);
  });

  it('turns noninteractive --execute into an actual preview instead of requesting deletion', async () => {
    const result = await FlowVersionPrune.run([...args, '--execute']);
    expect(result).to.include({ dryRun: true, outcome: 'previewed', confirmed: false });
    expect(planStub.calledOnce).to.equal(true);
    expect(execute.called || confirm.called).to.equal(false);
  });

  it('turns JSON --execute into preview even when input and output are interactive', async () => {
    interactive(true);
    const result = await FlowVersionPrune.run([...args, '--execute', '--json']);
    expect(result.dryRun).to.equal(true);
    expect(log.called || confirm.called || execute.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
  });

  it('does not prompt when stdout is redirected', async () => {
    interactive(true, false);
    const result = await FlowVersionPrune.run([...args, '--execute']);
    expect(result.dryRun).to.equal(true);
    expect(confirm.called || execute.called).to.equal(false);
  });

  for (const approval of ['--no-prompt', '-p', '--yes', '-y']) {
    it(`executes exact approved candidates with ${approval} in JSON/noninteractive mode`, async () => {
      const result = await FlowVersionPrune.run([...args, approval, '--json']);
      expect(confirm.called || log.called).to.equal(false);
      expect(execute.calledOnceWithExactly(plan)).to.equal(true);
      expect(result).to.include({ outcome: 'succeeded', dryRun: false, confirmed: true });
      expect(result.summary).to.include({ succeeded: 1, wouldDelete: 0 });
      expect(result.results[0]).to.include({ outcome: 'succeeded', versionNumber: 1 });
      expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
      expect(process.exitCode).to.equal(0);
    });
  }

  for (const approval of ['--no-prompt', '--yes', '--execute']) {
    it(`makes explicit --dry-run win over ${approval}`, async () => {
      const result = await FlowVersionPrune.run([...args, approval, '--dry-run', '--json']);
      expect(result).to.include({ dryRun: true, confirmed: false, outcome: 'previewed' });
      expect(execute.called || confirm.called).to.equal(false);
      expect(process.exitCode).to.equal(0);
    });
  }

  it('allows explicit no-prompt approval together with --execute without prompting', async () => {
    await FlowVersionPrune.run([...args, '--execute', '--no-prompt']);
    expect(execute.calledOnceWithExactly(plan)).to.equal(true);
    expect(confirm.called).to.equal(false);
  });

  it('displays the complete plan and allows one minute, default no, for interactive confirmation', async () => {
    interactive(true);
    const result = await FlowVersionPrune.run([...args, '--execute']);
    expect(log.calledBefore(confirm)).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({ ms: 60_000, defaultAnswer: false });
    expect(result).to.include({ outcome: 'cancelled', confirmed: false });
    expect(result.summary.succeeded).to.equal(0);
    expect(execute.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it('reports an actual confirmation timeout separately and exits 69 without mutation', async () => {
    interactive(true);
    confirm.rejects(new ConfirmationTimeoutError());
    const result = await FlowVersionPrune.run([...args, '--execute']);
    expect(result).to.include({ outcome: 'timed_out', confirmed: false, dryRun: false });
    expect(execute.called).to.equal(false);
    expect(process.exitCode).to.equal(69);
    expect(log.lastCall.args[0]).to.include('timed out');
  });

  it('executes only after explicit interactive approval', async () => {
    interactive(true);
    confirm.resolves(true);
    const result = await FlowVersionPrune.run([...args, '--execute']);
    expect(execute.calledOnceWithExactly(plan)).to.equal(true);
    expect(confirm.calledBefore(execute)).to.equal(true);
    expect(result).to.include({ outcome: 'succeeded', confirmed: true, dryRun: false });
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('keeps completed preview exit zero when it displays backend blocked or errored rows', async () => {
    Object.assign(plan.flows[0].versions[0], {
      disposition: 'ERROR',
      outcome: 'ERROR',
      deletable: false,
      reasonCode: 'OPERATIONAL',
      message: 'Assessment failed.',
      reasons: [{ code: 'OPERATIONAL', message: 'Assessment failed.' }],
    });
    const result = await FlowVersionPrune.run(args);
    expect(result.outcome).to.equal('previewed');
    expect(result.results[0]).to.include({ action: 'error', outcome: null });
    expect(result.summary.succeeded).to.equal(0);
    expect(process.exitCode).to.equal(0);
  });

  it('uses exit 1 for wholly blocked, failed and uncertain execution without treating errors as usage', async () => {
    Object.assign(deletion.results[0], {
      state: 'BLOCKED',
      targetDeleted: false,
      error: { code: 'ACTIVE_VERSION', message: 'The active version cannot be deleted.' },
      coreResult: {
        versionId: deletion.results[0].versionId,
        outcome: 'BLOCKED',
        reasonCode: 'ACTIVE_VERSION',
        message: 'The active version cannot be deleted.',
        evidence: [],
      },
    });
    const blocked = await FlowVersionPrune.run([...args, '--no-prompt']);
    expect(blocked.outcome).to.equal('blocked');
    expect(blocked.results[0].blockingReasons[0].code).to.equal('ACTIVE_VERSION');
    expect(process.exitCode).to.equal(1);
    Object.assign(deletion.results[0], {
      state: 'FAILED',
      error: { code: 'DELETE_ERROR', message: 'The version could not be deleted.' },
      coreResult: {
        versionId: deletion.results[0].versionId,
        outcome: 'ERROR',
        reasonCode: 'DELETE_ERROR',
        message: 'The version could not be deleted.',
        evidence: [],
      },
    });
    const failed = await FlowVersionPrune.run([...args, '--no-prompt']);
    expect(failed.results[0].outcome).to.equal('failed');
    expect(process.exitCode).to.equal(1);
    Object.assign(deletion.results[0], { state: 'UNKNOWN', targetDeleted: null, coreResult: null });
    const unknown = await FlowVersionPrune.run([...args, '--no-prompt']);
    expect(unknown.outcome).to.equal('unknown');
    expect(unknown.results[0].outcome).to.equal('unknown');
    expect(process.exitCode).to.equal(1);
  });

  it('renders an already-deleted Core acknowledgement as success while preserving its reason', async () => {
    Object.assign(deletion.results[0].coreResult!, {
      reasonCode: 'ALREADY_DELETED',
      message: 'This version is already deleted.',
    });
    const result = await FlowVersionPrune.run([...args, '--no-prompt']);
    expect(log.lastCall.args[0]).to.include('Invoice v1 | DELETED');
    expect(log.lastCall.args[0]).to.include('ALREADY_DELETED: This version is already deleted.');
    expect(result.outcome).to.equal('succeeded');
    expect(result.results[0]).to.include({
      reasonCode: 'ALREADY_DELETED',
      message: 'This version is already deleted.',
    });
    expect(result.results[0].blockingReasons).to.deep.equal([]);
    expect(process.exitCode).to.equal(0);
  });

  it('includes relevant blocked and errored planned rows even when there are no execution candidates', async () => {
    deletion.results = [];
    Object.assign(plan.flows[0].versions[0], {
      disposition: 'BLOCKED',
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'HAS_INTERVIEWS',
      message: 'HAS_INTERVIEWS (1)',
      reasons: [{ code: 'HAS_INTERVIEWS', message: 'HAS_INTERVIEWS (1)' }],
    });
    const blocked = await FlowVersionPrune.run([...args, '--no-prompt']);
    expect(blocked.outcome).to.equal('blocked');
    expect(blocked.summary).to.include({ blocked: 1, succeeded: 0 });
    expect(blocked.results[0].blockingReasons[0]).to.include({ code: 'HAS_INTERVIEWS', count: null });
    expect(confirm.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
    Object.assign(plan.flows[0].versions[0], {
      disposition: 'ERROR',
      outcome: 'ERROR',
      reasonCode: 'OPERATIONAL',
      message: 'Assessment failed.',
      reasons: [{ code: 'OPERATIONAL', message: 'Assessment failed.' }],
    });
    const failed = await FlowVersionPrune.run([...args, '--no-prompt']);
    expect(failed.outcome).to.equal('failed');
    expect(process.exitCode).to.equal(1);
  });

  it('reports partial success as 68 without dropping results from nonzero JSON output', async () => {
    plan.flows[0].versions.push({
      ...plan.flows[0].versions[0],
      versionId: '301000000000002AAA',
      versionNumber: 2,
      disposition: 'BLOCKED',
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'HAS_INTERVIEWS',
      message: 'HAS_INTERVIEWS (1)',
      reasons: [{ code: 'HAS_INTERVIEWS', message: 'HAS_INTERVIEWS (1)' }],
    });
    const result = await FlowVersionPrune.run([...args, '--no-prompt', '--json']);
    expect(result.outcome).to.equal('partial');
    expect(result.summary).to.include({ succeeded: 1, blocked: 1 });
    expect(result.results.map((row) => row.outcome)).to.deep.equal(['succeeded', 'blocked']);
    expect(process.exitCode).to.equal(68);
    const envelope = logJson.firstCall.args[0] as { status: number; result: unknown };
    expect(envelope.status).to.equal(68);
    expect(envelope.result).to.deep.equal(result);
    expect(String(log.lastCall?.args[0] ?? '')).not.to.include('FAILED');
  });

  it('does not count protected rows as successes or failures when Core eligibility is unavailable', async () => {
    Object.assign(plan.flows[0].versions[0], {
      ageDays: 2,
      disposition: 'KEPT',
      outcome: 'ERROR',
      deletable: false,
      reasonCode: 'OPERATIONAL',
      reasons: [{ code: 'AGE_THRESHOLD', message: 'Keep younger versions.' }],
    });
    deletion.results = [];
    const result = await FlowVersionPrune.run([...args, '--no-prompt']);
    expect(result.outcome).to.equal('succeeded');
    expect(result.summary).to.include({ succeeded: 0, failed: 0, blocked: 0, kept: 1 });
    expect(result.results[0]).to.include({ action: 'keep', outcome: null });
    expect(process.exitCode).to.equal(0);
  });

  it('sanitizes controls in console formatting while leaving structured report data unchanged', () => {
    const result = internalReport(plan);
    result.targetOrg = '\u001b[31morg\u001b[0m\u202e\nspoof';
    const output = formatVersionPruneReport(result);
    expect(output).not.to.include('\u001b');
    expect(output).not.to.include('\u202e');
    expect(output).to.include('org  spoof');
    expect(result.targetOrg).to.include('\u001b');
  });

  it('enforces the shared JSON contract version and excludes internal and unexpected report properties', async () => {
    const result = await FlowVersionPrune.run(args);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
    expect(validateReport({ ...result, contractVersion: '2' })).to.equal(false);
    expect(validateReport({ ...result, fakeCounts: [] })).to.equal(false);
    expect(result).not.to.have.any.keys('plan', 'deletion');
    expect(result.summary.succeeded).to.equal(0);
    expect(result.results.every((row) => row.outcome === null)).to.equal(true);
  });
});
