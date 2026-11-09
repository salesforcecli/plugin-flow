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

import { expect } from 'chai';
import sinon from 'sinon';
import {
  FlowVersionDeleteRequestError,
  FlowVersionDeleteService,
  type ConnectFlowVersionListReport,
  type ConnectFlowVersionListVersion,
  type FlowVersionAssessmentTarget,
  type FlowVersionCoreDeleteResult,
} from '@salesforce/flow-node';
import {
  classifyRetentionFlow,
  FlowVersionRetentionService,
  retentionPolicy,
} from '../../src/services/flowVersionRetention.js';

const checksum = (base: string): string =>
  base +
  [0, 5, 10]
    .map(
      (start) =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[
          [...base.slice(start, start + 5)].reduce((mask, char, bit) => mask | (/[A-Z]/.test(char) ? 1 << bit : 0), 0)
        ]
    )
    .join('');
const orgId = checksum('00D000000000001');
const definitionId = checksum('300000000000001');
const row = (n: number, extra: Partial<ConnectFlowVersionListVersion> = {}): ConnectFlowVersionListVersion => ({
  versionId: checksum(`301${String(n).padStart(12, '0')}`),
  versionNumber: n,
  versionName: null,
  status: 'Draft',
  createdDate: '2026-01-01T00:00:00Z',
  ageDays: 299,
  createdById: null,
  createdByName: null,
  lastModifiedDate: '2026-10-20T00:00:00Z',
  statusChangeDate: null,
  referenceCount: 0,
  pausedInterviewCount: 0,
  failedInterviewCount: 0,
  deletable: true,
  outcome: 'PASS',
  reasonCode: null,
  message: null,
  ...extra,
});
const report = (versions: ConnectFlowVersionListVersion[]): ConnectFlowVersionListReport => ({
  contractVersion: '1',
  orgId,
  generatedAt: '2026-10-27T00:00:00Z',
  scope: { all: false, flowName: 'billing__Invoice', namespace: null, allNamespaces: true },
  filters: { status: null, olderThan: null, minPercent: null, deletable: false },
  versionLimit: 50,
  returnedVersionCount: versions.length,
  candidateVersionCount: versions.length,
  listTruncated: false,
  catalogComplete: true,
  nextOffset: null,
  flows: [
    {
      definitionId,
      apiName: 'billing__Invoice',
      label: 'Invoice',
      versionCount: versions.length,
      limitPercent: versions.length * 2,
      versions,
    },
  ],
});
const policy = { keepLatest: 1, olderThanDays: 90 };
const classify = (versions: ConnectFlowVersionListVersion[]): ReturnType<typeof classifyRetentionFlow> =>
  classifyRetentionFlow(report(versions).flows[0], policy);
const reject = async (operation: Promise<unknown>, code: string): Promise<void> => {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(caught).to.have.property('code', code);
};

describe('C4 retention policy', () => {
  it('protects Active, latest N, and newest Obsolete statusChangeDate before age/eligibility filtering', () => {
    const result = classify([
      row(1, { status: 'Active' }),
      row(2, { status: 'Obsolete', statusChangeDate: '2026-03-01T12:00:00Z' }),
      row(3, {
        status: 'Obsolete',
        statusChangeDate: '2026-02-01T12:00:00Z',
        lastModifiedDate: '2026-10-27T12:00:00Z',
      }),
      row(4),
      row(7),
    ]);
    expect(result.versions.map((item) => item.disposition)).to.deep.equal([
      'KEPT',
      'KEPT',
      'CANDIDATE',
      'CANDIDATE',
      'KEPT',
    ]);
    expect(result.versions[1].reasons[0].code).to.equal('PREVIOUSLY_ACTIVE');
  });

  it('never lets a null timestamp beat a stored time', () => {
    const result = classify([
      row(1, { status: 'Obsolete', statusChangeDate: null }),
      row(2, { status: 'Obsolete', statusChangeDate: '2026-03-01T12:00:00Z' }),
      row(3),
    ]);
    expect(result.versions[0].disposition).to.equal('CANDIDATE');
    expect(result.versions[1].disposition).to.equal('KEPT');
  });

  it('conservatively protects all tied newest timestamps and all Obsolete when every timestamp is null', () => {
    const tied = classify([
      row(1, { status: 'Obsolete', statusChangeDate: '2026-03-01T12:00:00Z' }),
      row(2, { status: 'Obsolete', statusChangeDate: '2026-03-01T12:00:00Z' }),
      row(3),
    ]);
    expect(tied.versions.slice(0, 2).map((item) => item.reasons[0].code)).to.deep.equal([
      'ROLLBACK_TIME_TIE',
      'ROLLBACK_TIME_TIE',
    ]);
    const undated = classify([row(1, { status: 'Obsolete' }), row(2, { status: 'Obsolete' }), row(3)]);
    expect(undated.versions.slice(0, 2).map((item) => item.reasons[0].code)).to.deep.equal([
      'ROLLBACK_TIME_UNAVAILABLE',
      'ROLLBACK_TIME_UNAVAILABLE',
    ]);
  });

  it('distinguishes old-server missing field from valid stored null', () => {
    const version = row(1);
    Reflect.deleteProperty(version, 'statusChangeDate');
    expect(() => classify([version, row(2)])).to.throw('Rebuild and restart');
  });

  it('does not authorize a Flow when an unknown status prevents determining the protected set', () => {
    const result = classify([row(1, { status: null }), row(2), row(3)]);
    expect(result.versions.every((item) => item.disposition === 'ERROR')).to.equal(true);
  });

  it('retains genuine backend blockers and errors, uses inclusive server ages, and never substitutes a zero age', () => {
    const result = classify([
      row(1, {
        outcome: 'BLOCKED',
        deletable: false,
        reasonCode: 'PAUSED_INTERVIEWS',
        message: 'PAUSED_INTERVIEWS (2)',
      }),
      row(2, { outcome: 'ERROR', deletable: false, reasonCode: 'OPERATIONAL' }),
      row(3, { ageDays: 89 }),
      row(4, { ageDays: 90 }),
      row(5, { ageDays: null }),
      row(6),
    ]);
    expect(result.versions.map((item) => item.disposition)).to.deep.equal([
      'BLOCKED',
      'ERROR',
      'KEPT',
      'CANDIDATE',
      'ERROR',
      'KEPT',
    ]);
    expect(result.versions[0].reasons[0].message).to.equal('PAUSED_INTERVIEWS (2)');
  });

  it('keeps young rows before checking backend eligibility, while preserving actual backend error and blocker metadata', () => {
    const result = classify([
      row(1, {
        ageDays: 3,
        outcome: 'BLOCKED',
        deletable: false,
        reasonCode: 'PAUSED_INTERVIEWS',
        message: 'PAUSED_INTERVIEWS (1)',
      }),
      row(2, { ageDays: 4, outcome: 'ERROR', deletable: false, reasonCode: 'OPERATIONAL' }),
      row(3),
    ]);
    expect(result.versions.slice(0, 2).map((item) => item.disposition)).to.deep.equal(['KEPT', 'KEPT']);
    expect(result.versions[0].message).to.equal('PAUSED_INTERVIEWS (1)');
    expect(result.versions[1].outcome).to.equal('ERROR');
  });

  it('validates configurable retention values without inventing alternate units or zero retained versions', () => {
    expect(retentionPolicy(5, '90d')).to.deep.equal({ keepLatest: 5, olderThanDays: 90 });
    for (const keep of [0, -1, 1.2, Number.NaN]) expect(() => retentionPolicy(keep, '90d')).to.throw();
    for (const age of ['90', '1h', '-1d', '1.2d', '36501d']) expect(() => retentionPolicy(5, age)).to.throw();
  });
});

describe('C4 retention execution', () => {
  const sandbox = sinon.createSandbox();
  let current: ConnectFlowVersionListReport;
  let currentOrg: string;
  let list: sinon.SinonStub;
  let assess: sinon.SinonStub;
  let remove: sinon.SinonStub;
  let service: FlowVersionRetentionService;

  beforeEach(() => {
    current = report([row(3), row(2), row(1)]);
    currentOrg = orgId;
    list = sandbox.stub().callsFake(() => structuredClone(current));
    assess = sandbox.stub().throws('Real C4 execution must not request a separate delete preview');
    remove = sandbox.stub().callsFake((targets: readonly FlowVersionAssessmentTarget[]) => {
      const results: FlowVersionCoreDeleteResult[] = targets.map((target) => {
        const flow = current.flows.find((item) => item.definitionId === target.expectedDefinitionId)!;
        flow.versions = flow.versions.filter((version) => version.versionId !== target.versionId);
        flow.versionCount = flow.versions.length;
        flow.limitPercent = flow.versions.length * 2;
        return { versionId: target.versionId, outcome: 'DELETED', reasonCode: null, message: null, evidence: [] };
      });
      current.candidateVersionCount = current.returnedVersionCount = current.flows.reduce(
        (count, flow) => count + flow.versions.length,
        0
      );
      return Promise.resolve(results);
    });
    service = new FlowVersionRetentionService(
      { list },
      {
        getOrgId: () => currentOrg,
        inventory: sandbox.stub().throws('C4 does not guess namespace'),
        assessVersions: assess,
        deleteVersions: remove,
      }
    );
  });
  afterEach(() => sandbox.restore());

  it('pages/list-merges through the C1 client before selecting, and a preview calls only unfiltered C1', async () => {
    const plan = await service.plan({ all: true }, policy);
    expect(list.calledOnceWithExactly({ all: true })).to.equal(true);
    expect(plan.flows[0].versions.map((item) => item.disposition)).to.deep.equal(['KEPT', 'CANDIDATE', 'CANDIDATE']);
    expect(assess.called || remove.called).to.equal(false);
  });

  it('snapshots the validated policy before the first asynchronous catalog read', async () => {
    let finish: (() => void) | undefined;
    list.callsFake(
      () =>
        new Promise<ConnectFlowVersionListReport>((resolve) => {
          finish = () => resolve(structuredClone(current));
        })
    );
    const supplied = { ...policy };
    const pending = service.plan({ all: true }, supplied);
    supplied.keepLatest = 3;
    supplied.olderThanDays = 0;
    finish!();
    const plan = await pending;
    expect(plan.policy).to.deep.equal(policy);
    expect(plan.flows[0].versions.filter((item) => item.disposition === 'CANDIDATE')).to.have.length(2);
  });

  it('rejects incomplete catalogs and old backend metadata with no deletion', async () => {
    current.catalogComplete = false;
    await reject(service.plan({ all: true }, policy), 'RETENTION_CATALOG_INCOMPLETE');
    current.catalogComplete = true;
    Reflect.deleteProperty(current.flows[0].versions[0], 'statusChangeDate');
    await reject(service.plan({ all: true }, policy), 'RETENTION_METADATA_UNAVAILABLE');
    expect(remove.called).to.equal(false);
  });

  it('reuses Core deletion for exact approved IDs without a preview round, including fully qualified API names', async () => {
    const plan = await service.plan({ flowName: 'billing__Invoice' }, policy);
    const result = await service.execute(plan);
    expect(result.outcome).to.equal('SUCCEEDED');
    expect(result.results.map((item) => item.versionNumber)).to.deep.equal([1, 2]);
    expect(remove.args).to.deep.equal([
      [[{ versionId: row(1).versionId, expectedDefinitionId: definitionId }]],
      [[{ versionId: row(2).versionId, expectedDefinitionId: definitionId }]],
    ]);
    expect(assess.called).to.equal(false);
    expect(list.callCount).to.be.greaterThan(3);
    expect(list.args.every(([input]) => !('status' in input) && !('deletable' in input))).to.equal(true);
    expect(current.flows[0].versions.map((item) => item.versionNumber)).to.deep.equal([3]);
  });

  it('never retargets a replaced version number after preview', async () => {
    const plan = await service.plan({ all: true }, policy);
    current.flows[0].versions[2].versionId = row(10).versionId;
    const result = await service.execute(plan);
    expect(result.results.map((item) => item.state)).to.deep.equal(['FAILED', 'SUCCEEDED']);
    expect(result.results[0].error?.code).to.equal('TARGET_CHANGED');
    expect(remove.args).to.deep.equal([[[{ versionId: row(2).versionId, expectedDefinitionId: definitionId }]]]);
  });

  it('fresh retention check protects a candidate that became the rollback target before Core deletion', async () => {
    const plan = await service.plan({ all: true }, policy);
    // Execution resolves the exact ID first; the following read is the retention-policy recheck.
    list.onCall(list.callCount + 1).callsFake(() => {
      current.flows[0].versions[2].status = 'Obsolete';
      current.flows[0].versions[2].statusChangeDate = '2026-10-27T12:00:00Z';
      return structuredClone(current);
    });
    const result = await service.execute(plan);
    expect(result.results.map((item) => item.state)).to.deep.equal(['BLOCKED', 'SUCCEEDED']);
    expect(result.results[0].source).to.equal('CLIENT_POLICY');
    expect(remove.args).to.deep.equal([[[{ versionId: row(2).versionId, expectedDefinitionId: definitionId }]]]);
    expect(assess.called).to.equal(false);
  });

  it('keeps a fresh catalog assessment error distinct from a blocker and continues an eligible sibling', async () => {
    const plan = await service.plan({ all: true }, policy);
    list.onCall(list.callCount + 1).callsFake(() => {
      Object.assign(current.flows[0].versions[2], { outcome: 'ERROR', deletable: false, reasonCode: 'DELETE_ERROR' });
      return structuredClone(current);
    });
    const result = await service.execute(plan);
    expect(result.results.map((item) => item.state)).to.deep.equal(['FAILED', 'SUCCEEDED']);
    expect(result.results[0].error?.code).to.equal('RETENTION_RECHECK_ERROR');
    expect(remove.args).to.deep.equal([[[{ versionId: row(2).versionId, expectedDefinitionId: definitionId }]]]);
    expect(assess.called).to.equal(false);
  });

  it('retains actual Core blocker results while continuing eligible siblings', async () => {
    const plan = await service.plan({ all: true }, policy);
    remove.callsFake((targets: readonly FlowVersionAssessmentTarget[]) =>
      Promise.resolve(
        targets.map(
          (target): FlowVersionCoreDeleteResult => ({
            versionId: target.versionId,
            outcome: target.versionId === row(1).versionId ? 'BLOCKED' : 'DELETED',
            reasonCode: target.versionId === row(1).versionId ? 'HAS_INTERVIEWS' : null,
            message: target.versionId === row(1).versionId ? 'Saved interviews still point at this version.' : null,
            evidence: [],
          })
        )
      )
    );
    const result = await service.execute(plan);
    expect(result.results.map((item) => item.state)).to.deep.equal(['BLOCKED', 'SUCCEEDED']);
    expect(result.results[0].source).to.equal('CORE');
    expect(result.results[0].coreResult).to.include({
      outcome: 'BLOCKED',
      reasonCode: 'HAS_INTERVIEWS',
      message: 'Saved interviews still point at this version.',
    });
    expect(result.results[0].coreResult?.evidence).to.deep.equal([]);
    expect(remove.args).to.deep.equal([
      [[{ versionId: row(1).versionId, expectedDefinitionId: definitionId }]],
      [[{ versionId: row(2).versionId, expectedDefinitionId: definitionId }]],
    ]);
    expect(assess.called).to.equal(false);
  });

  it('preserves a Core error outcome and continues the next approved retention candidate', async () => {
    const plan = await service.plan({ all: true }, policy);
    remove.callsFake((targets: readonly FlowVersionAssessmentTarget[]) =>
      Promise.resolve(
        targets.map(
          (target): FlowVersionCoreDeleteResult => ({
            versionId: target.versionId,
            outcome: target.versionId === row(1).versionId ? 'ERROR' : 'DELETED',
            reasonCode: target.versionId === row(1).versionId ? 'DELETE_ERROR' : null,
            message: target.versionId === row(1).versionId ? 'The version could not be deleted.' : null,
            evidence: [],
          })
        )
      )
    );
    const result = await service.execute(plan);
    expect(result.results.map((item) => item.state)).to.deep.equal(['FAILED', 'SUCCEEDED']);
    expect(result.results[0].source).to.equal('CORE');
    expect(result.results[0].coreResult?.outcome).to.equal('ERROR');
    expect(result.results[0].error?.code).to.equal('DELETE_ERROR');
    expect(remove.callCount).to.equal(2);
  });

  it('stops all later flows after an uncertain Core bulk-delete request', async () => {
    const second = {
      ...structuredClone(current.flows[0]),
      definitionId: checksum('300000000000002'),
      apiName: 'OtherFlow',
      versions: [row(4), row(5)],
    };
    second.versionCount = 2;
    current.flows.push(second);
    current.candidateVersionCount = current.returnedVersionCount = 5;
    list.callsFake((scope: { flowName?: string }) => {
      const value = structuredClone(current);
      if (scope.flowName) value.flows = value.flows.filter((flow) => flow.apiName === scope.flowName);
      return value;
    });
    remove.rejects(new FlowVersionDeleteRequestError('NETWORK', 'No response.', false, null, true));
    const result = await service.execute(await service.plan({ all: true }, policy));
    expect(result.results.map((item) => item.state)).to.deep.equal(['UNKNOWN', 'NOT_ATTEMPTED', 'NOT_ATTEMPTED']);
    expect(remove.calledOnce).to.equal(true);
    expect(result.outcome).to.equal('UNKNOWN');
  });

  it('binds plans to the originating service/org and rejects mutation/replay', async () => {
    const plan = await service.plan({ all: true }, policy);
    await reject(service.execute(structuredClone(plan)), 'INVALID_RETENTION_PLAN');
    plan.policy.keepLatest = 2;
    await reject(service.execute(plan), 'INVALID_RETENTION_PLAN');
    const clean = await service.plan({ all: true }, policy);
    currentOrg = checksum('00D000000000002');
    await reject(service.execute(clean), 'ORG_MISMATCH');
    currentOrg = orgId;
    await service.execute(clean);
    await reject(service.execute(clean), 'RETENTION_PLAN_ALREADY_EXECUTED');
  });

  it('treats a lost execution report as UNKNOWN and stops instead of claiming that nothing happened', async () => {
    const plan = await service.plan({ all: true }, policy);
    sandbox.stub(FlowVersionDeleteService.prototype, 'execute').rejects(new Error('Unexpected failure'));
    const result = await service.execute(plan);
    expect(result.results.map((item) => item.state)).to.deep.equal(['UNKNOWN', 'NOT_ATTEMPTED']);
    expect(result.results.every((item) => item.targetDeleted === null)).to.equal(true);
    expect(result.outcome).to.equal('UNKNOWN');
  });
});
