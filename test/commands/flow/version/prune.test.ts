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
    assessment: { versionId: row.versionId, outcome: 'PASS', reasonCode: null, message: null, evidence: [] },
    error: null,
    state: 'SUCCEEDED',
    targetDeleted: true,
    source: 'TOOLING',
  })),
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
  let originalTTY: PropertyDescriptor | undefined;
  const interactive = (value: boolean): void => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
  };
  const error = async (commandArgs: string[]): Promise<unknown> => {
    let caught: unknown;
    try {
      await FlowVersionPrune.run(commandArgs);
    } catch (item) {
      caught = item;
    }
    expect(caught).to.be.instanceOf(Error);
    return caught;
  };

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
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
    if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
  });

  it('defaults to preview with PRD defaults and performs no confirmation or execution', async () => {
    const result = await FlowVersionPrune.run(args);
    expect(planStub.firstCall.args).to.deep.equal([{ flowName: 'Invoice' }, { keepLatest: 5, olderThanDays: 90 }]);
    expect(result).to.include({ dryRun: true, confirmed: false, outcome: 'PREVIEWED', deletion: null });
    expect(confirm.called || execute.called).to.equal(false);
    expect(String(log.firstCall.args[0])).to.include('No deletion requests were sent.');
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

  it('uses the installed C1 client and consumes the later page before protecting latest and rollback versions', async () => {
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
    expect(result.plan.flows[0].versions.map((item) => item.disposition)).to.deep.equal([
      'CANDIDATE',
      'CANDIDATE',
      'KEPT',
      'KEPT',
    ]);
    for (const call of request.getCalls()) {
      const req = call.args[0] as { method: string; url: string; body: string };
      const body = JSON.parse(req.body) as Record<string, unknown>;
      expect(req).to.include({ method: 'POST', url: '/connect/interaction/flow-versions/list' });
      expect(body).not.to.have.property('status');
      expect(body).not.to.have.property('olderThanDays');
      expect(body).not.to.have.property('deletable');
    }
    expect(JSON.parse((request.secondCall.args[0] as { body: string }).body)).to.include({ offset: 100 });
    expect(execute.called || confirm.called).to.equal(false);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('requires exactly one scope and rejects conflicting execution options before planning', async () => {
    await error(['-o', 'source']);
    await error([...args, '--all']);
    for (const flags of [
      ['--yes', '--dry-run'],
      ['--execute', '--dry-run'],
      ['--execute', '--yes'],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Command tests share process state and must run sequentially.
      await error([...args, ...flags]);
    }
    expect(planStub.called || execute.called).to.equal(false);
  });

  it('validates policy options before planning', async () => {
    await error([...args, '--keep-latest', '0']);
    await error([...args, '--older-than', '90']);
    expect(planStub.called).to.equal(false);
  });

  it('rejects noninteractive and JSON --execute without silently falling back to deletion', async () => {
    await error([...args, '--execute']);
    interactive(true);
    await error([...args, '--execute', '--json']);
    expect(planStub.called || execute.called || confirm.called).to.equal(false);
  });

  it('displays the complete plan and allows one minute, default no, for interactive confirmation', async () => {
    interactive(true);
    const result = await FlowVersionPrune.run([...args, '--execute']);
    expect(log.calledBefore(confirm)).to.equal(true);
    expect(confirm.firstCall.args[0]).to.include({ ms: 60_000, defaultAnswer: false });
    expect(result).to.include({ outcome: 'CANCELLED', confirmed: false, deletion: null });
    expect(execute.called).to.equal(false);
  });

  it('executes only after explicit interactive approval', async () => {
    interactive(true);
    confirm.resolves(true);
    const result = await FlowVersionPrune.run([...args, '--execute']);
    expect(execute.calledOnceWithExactly(plan)).to.equal(true);
    expect(confirm.calledBefore(execute)).to.equal(true);
    expect(result).to.include({ outcome: 'SUCCEEDED', confirmed: true, dryRun: false });
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('executes exact planned targets with --yes and no prompt in JSON/noninteractive mode', async () => {
    const result = await FlowVersionPrune.run([...args, '--yes', '--json']);
    expect(confirm.called || log.called).to.equal(false);
    expect(execute.calledOnceWithExactly(plan)).to.equal(true);
    expect(result.deletion).to.equal(deletion);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
  });

  it('keeps completed preview exit zero even when it displays backend blocked/error rows', async () => {
    Object.assign(plan.flows[0].versions[0], {
      disposition: 'ERROR',
      outcome: 'ERROR',
      deletable: false,
      reasonCode: 'OPERATIONAL',
    });
    const result = await FlowVersionPrune.run(args);
    expect(result.outcome).to.equal('PREVIEWED');
    expect(process.exitCode).not.to.equal(1);
    expect(process.exitCode).not.to.equal(2);
  });

  it('returns exit 1 for a blocker, and 2 for a failed or uncertain execution', async () => {
    Object.assign(deletion.results[0], {
      state: 'BLOCKED',
      targetDeleted: false,
      error: { code: 'ACTIVE_VERSION', message: 'ACTIVE_VERSION' },
    });
    await FlowVersionPrune.run([...args, '--yes']);
    expect(process.exitCode).to.equal(1);
    Object.assign(deletion.results[0], { state: 'FAILED' });
    await FlowVersionPrune.run([...args, '--yes']);
    expect(process.exitCode).to.equal(2);
    Object.assign(deletion.results[0], { state: 'UNKNOWN', targetDeleted: null });
    await FlowVersionPrune.run([...args, '--yes']);
    expect(process.exitCode).to.equal(2);
  });

  it('aligns overall outcome and exit code for blocked or errored rows outside the candidate set', async () => {
    deletion.results = [];
    Object.assign(plan.flows[0].versions[0], {
      disposition: 'BLOCKED',
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'PAUSED_INTERVIEWS',
      message: 'PAUSED_INTERVIEWS (1)',
    });
    const blocked = await FlowVersionPrune.run([...args, '--yes']);
    expect(blocked.outcome).to.equal('FAILED');
    expect(process.exitCode).to.equal(1);
    Object.assign(plan.flows[0].versions[0], { disposition: 'ERROR', outcome: 'ERROR', reasonCode: 'OPERATIONAL' });
    const failed = await FlowVersionPrune.run([...args, '--yes']);
    expect(failed.outcome).to.equal('FAILED');
    expect(process.exitCode).to.equal(2);
  });

  it('reports PARTIAL when a candidate succeeds but another retention-eligible row was blocked at preview', async () => {
    plan.flows[0].versions.push({
      ...plan.flows[0].versions[0],
      versionId: '301000000000002AAA',
      versionNumber: 2,
      disposition: 'BLOCKED',
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'PAUSED_INTERVIEWS',
      message: 'PAUSED_INTERVIEWS (1)',
    });
    const result = await FlowVersionPrune.run([...args, '--yes']);
    expect(result.outcome).to.equal('PARTIAL');
    expect(process.exitCode).to.equal(1);
    expect(result.deletion?.outcome).to.equal('SUCCEEDED');
  });

  it('does not fail cleanup for a young protected row whose backend assessment is ERROR', async () => {
    Object.assign(plan.flows[0].versions[0], {
      ageDays: 2,
      disposition: 'KEPT',
      outcome: 'ERROR',
      deletable: false,
      reasonCode: 'OPERATIONAL',
      reasons: [{ code: 'AGE_THRESHOLD', message: 'Keep younger versions.' }],
    });
    deletion.results = [];
    const result = await FlowVersionPrune.run([...args, '--yes']);
    expect(result.outcome).to.equal('SUCCEEDED');
    expect(process.exitCode).to.equal(0);
    expect(result.plan.flows[0].versions[0].outcome).to.equal('ERROR');
  });

  it('sanitizes controls in console output while leaving structured data unchanged', async () => {
    const result = await FlowVersionPrune.run(args);
    result.targetOrg = '\u001b[31morg\u001b[0m\u202e\nspoof';
    const output = formatVersionPruneReport(result);
    expect(output).not.to.include('\u001b');
    expect(output).not.to.include('\u202e');
    expect(output).to.include('org  spoof');
    expect(result.targetOrg).to.include('\u001b');
  });

  it('enforces stable JSON version and no unexpected report properties', async () => {
    const result: FlowVersionPruneCommandReport = await FlowVersionPrune.run(args);
    expect(validateReport(result), JSON.stringify(validateReport.errors)).to.equal(true);
    expect(validateReport({ ...result, contractVersion: '2' })).to.equal(false);
    expect(validateReport({ ...result, fakeCounts: [] })).to.equal(false);
    expect(validateReport({ ...result, dryRun: false })).to.equal(false);
  });
});
