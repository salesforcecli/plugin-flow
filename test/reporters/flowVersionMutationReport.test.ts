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
import type {
  FlowVersionAssessmentResult,
  FlowVersionDeleteResult,
  FlowVersionDeleteTarget,
  FlowVersionForceDeletePlan,
  FlowVersionForceDeleteResult,
} from '@salesforce/flow-node';
import type { FlowVersionDeleteCommandReport } from '../../src/commands/flow/version/delete.js';
import type { FlowVersionPruneCommandReport } from '../../src/commands/flow/version/prune.js';
import type { FlowVersionForceDeleteCommandReport } from '../../src/services/flowVersionForceDeletion.js';
import type { RetentionFlow, RetentionVersion } from '../../src/services/flowVersionRetention.js';
import {
  listExitCode,
  mutationExitCode,
  projectForceReport,
  projectNormalReport,
  projectPruneReport,
} from '../../src/reporters/flowVersionMutationReport.js';

const definitionA = '300xx000000bojNAAQ';
const definitionB = '300xx000000bpU9AAI';
const versionA = '301xx000003Ga19AAC';
const versionB = '301xx000003Ga9DAAS';
const orgId = '00D000000000001EAA';

const assessment = (overrides: Partial<FlowVersionAssessmentResult> = {}): FlowVersionAssessmentResult => ({
  versionId: versionA,
  outcome: 'PASS',
  reasonCode: null,
  message: null,
  evidence: [],
  ...overrides,
});
const target = (overrides: Partial<FlowVersionDeleteTarget> = {}): FlowVersionDeleteTarget => ({
  definitionId: definitionA,
  versionId: versionA,
  flowName: 'Invoice',
  namespace: null,
  versionNumber: 1,
  status: 'Draft',
  assessment: assessment(),
  error: null,
  ...overrides,
});
const result = (overrides: Partial<FlowVersionDeleteResult> = {}): FlowVersionDeleteResult => ({
  ...target(),
  state: 'SUCCEEDED',
  targetDeleted: true,
  source: 'CORE',
  coreResult: { versionId: versionA, outcome: 'DELETED', reasonCode: null, message: null, evidence: [] },
  ...overrides,
});
const normal = (overrides: Partial<FlowVersionDeleteCommandReport> = {}): FlowVersionDeleteCommandReport => ({
  contractVersion: '2',
  mode: 'NORMAL',
  targetOrg: 'unit@example.com',
  apiVersion: '67.0',
  dryRun: true,
  confirmed: false,
  outcome: 'PREVIEWED',
  deletion: null,
  plan: {
    contractVersion: '2',
    orgId,
    definitionId: definitionA,
    flowName: 'Invoice',
    namespace: null,
    requestedVersions: [1],
    versions: [target()],
    availableVersionCount: 3,
    warnings: [],
  },
  ...overrides,
});
const executedNormal = (results: FlowVersionDeleteResult[]): FlowVersionDeleteCommandReport => {
  const report = normal({ dryRun: false, confirmed: true, outcome: 'SUCCEEDED' });
  report.plan.versions = results;
  report.deletion = {
    contractVersion: '2',
    mode: 'NORMAL',
    orgId,
    definitionId: definitionA,
    flowName: 'Invoice',
    namespace: null,
    outcome: 'SUCCEEDED',
    results,
    warnings: [],
  };
  return report;
};
const forcePlan = (): FlowVersionForceDeletePlan => ({
  contractVersion: '1',
  orgId,
  definitionId: definitionA,
  versionId: versionA,
  flowName: 'Invoice',
  namespace: null,
  versionNumber: 1,
  availableVersionCount: 3,
  executionBlockers: [],
  impact: {
    versionId: versionA,
    flowApiName: 'Invoice',
    versionNumber: 1,
    versionStatus: 'Draft',
    deletable: false,
    evaluationComplete: true,
    reasons: [{ code: 'PAUSED_INTERVIEWS', message: 'Two saved interviews.', count: 2 }],
    interviews: [
      { id: '0Fo000000000001', status: 'Paused', label: 'Saved', createdDate: null, ownerId: null },
      { id: '0Fo000000000002', status: 'Error', label: null, createdDate: null, ownerId: null },
    ],
    interviewsTruncated: false,
    interviewCountLowerBound: 2,
    coverage: 'KNOWN_BLOCKERS',
    eligibilityIsAdvisory: true,
  },
});
const force = (overrides: Partial<FlowVersionForceDeleteCommandReport> = {}): FlowVersionForceDeleteCommandReport => ({
  contractVersion: '1',
  mode: 'FORCE',
  targetOrg: 'unit@example.com',
  apiVersion: '67.0',
  dryRun: true,
  confirmed: false,
  confirmationMethod: null,
  outcome: 'PREVIEWED',
  plan: forcePlan(),
  deletion: null,
  ...overrides,
});
const forceResult = (overrides: Partial<FlowVersionForceDeleteResult> = {}): FlowVersionForceDeleteResult => ({
  contractVersion: '1',
  mode: 'FORCE',
  orgId,
  definitionId: definitionA,
  versionId: versionA,
  flowName: 'Invoice',
  namespace: null,
  versionNumber: 1,
  state: 'DELETED',
  source: 'BACKEND',
  targetDeleted: true,
  operationId: 'operation-unit',
  interviewIds: ['0Fo000000000001'],
  scheduledWorkIds: ['work-unit'],
  reasons: [],
  errors: [],
  preview: null,
  hasMore: false,
  operations: [],
  error: null,
  ...overrides,
});
const retentionVersion = (overrides: Partial<RetentionVersion> = {}): RetentionVersion => ({
  versionId: versionA,
  versionNumber: 1,
  versionName: null,
  status: 'Draft',
  createdDate: null,
  ageDays: 100,
  createdById: null,
  createdByName: null,
  lastModifiedDate: null,
  statusChangeDate: null,
  referenceCount: null,
  pausedInterviewCount: null,
  failedInterviewCount: null,
  deletable: true,
  outcome: 'PASS',
  reasonCode: null,
  message: null,
  disposition: 'CANDIDATE',
  reasons: [{ code: 'RETENTION_CANDIDATE', message: 'Meets policy.' }],
  ...overrides,
});
const retentionFlow = (overrides: Partial<RetentionFlow> = {}): RetentionFlow => ({
  definitionId: definitionA,
  apiName: 'Invoice',
  label: 'Invoice',
  versionCount: 1,
  limitPercent: 2,
  versions: [retentionVersion()],
  ...overrides,
});
const prune = (overrides: Partial<FlowVersionPruneCommandReport> = {}): FlowVersionPruneCommandReport => ({
  contractVersion: '1',
  mode: 'RETENTION',
  targetOrg: 'unit@example.com',
  apiVersion: '67.0',
  dryRun: true,
  confirmed: false,
  outcome: 'PREVIEWED',
  deletion: null,
  plan: {
    orgId,
    generatedAt: '2026-11-09T00:00:00Z',
    scope: { all: false, flowName: 'Invoice', namespace: null, allNamespaces: true },
    policy: { keepLatest: 5, olderThanDays: 90 },
    flows: [retentionFlow()],
  },
  ...overrides,
});

describe('Flow version customer-facing mutation reports', () => {
  it('uses one public shape for all modes without exposing plans, SDK reports or service state', () => {
    const reports = [projectNormalReport(normal()), projectForceReport(force()), projectPruneReport(prune())];
    const keys = Object.keys(reports[0]).sort();
    for (const report of reports) {
      expect(report.contractVersion).to.equal('3');
      expect(Object.keys(report).sort()).to.deep.equal(keys);
      expect(report).not.to.have.property('plan');
      expect(report).not.to.have.property('deletion');
      expect(report).not.to.have.property('orgId');
      expect(report.summary.succeeded).to.equal(0);
      expect(report.results[0].outcome).to.equal(null);
      expect(report.summary.wouldDelete).to.equal(1);
    }
    expect(Object.keys(reports[0].results[0]).sort()).to.deep.equal(Object.keys(reports[1].results[0]).sort());
    expect(Object.keys(reports[0].results[0]).sort()).to.deep.equal(Object.keys(reports[2].results[0]).sort());
  });

  it('summarizes actual preview assessments while never claiming a deletion succeeded', () => {
    const report = normal();
    report.plan.versions = [
      target(),
      target({
        versionNumber: 2,
        versionId: versionB,
        assessment: assessment({ outcome: 'BLOCKED', reasonCode: 'HAS_INTERVIEWS', message: 'HAS_INTERVIEWS (99)' }),
      }),
      target({
        versionNumber: 7,
        versionId: null,
        assessment: null,
        error: { code: 'VERSION_NOT_FOUND', message: 'Requested version is absent.' },
      }),
    ];
    const output = projectNormalReport(report);
    expect(output.summary).to.deep.equal({
      succeeded: 0,
      blocked: 1,
      failed: 1,
      unknown: 0,
      notAttempted: 0,
      kept: 0,
      wouldDelete: 1,
    });
    expect(output.results.map((row) => row.outcome)).to.deep.equal([null, null, null]);
    expect(output.results[1].blockingReasons).to.deep.equal([
      { code: 'HAS_INTERVIEWS', message: 'HAS_INTERVIEWS (99)', count: null },
    ]);
    expect(output.results[2]).to.include({ versionNumber: 7, versionId: null, action: 'error' });
    expect(mutationExitCode(output)).to.equal(0);
  });

  it('keeps canceled unassessed targets selected without claiming assessment failure or eligibility', () => {
    const report = normal({ dryRun: false, outcome: 'CANCELLED' });
    report.plan.versions = [target({ assessment: null })];
    const output = projectNormalReport(report);
    expect(output.results[0]).to.include({ action: 'delete', outcome: null, error: null });
    expect(output.summary).to.include({ failed: 0, succeeded: 0, wouldDelete: 0 });
    expect(output.outcome).to.equal('cancelled');
    expect(mutationExitCode(output)).to.equal(1);
  });

  it('keeps timed-out unassessed targets selected without claiming eligibility', () => {
    const report = normal({ dryRun: false, outcome: 'TIMED_OUT' });
    report.plan.versions = [target({ assessment: null })];
    const output = projectNormalReport(report);
    expect(output.results[0]).to.include({ action: 'delete', outcome: null, error: null });
    expect(output.summary).to.include({ failed: 0, succeeded: 0, wouldDelete: 0 });
    expect(output.outcome).to.equal('timed_out');
    expect(mutationExitCode(output)).to.equal(69);
  });

  it('fails closed on a real preview that lacks a required assessment', () => {
    const report = normal();
    report.plan.versions = [target({ assessment: null })];
    const output = projectNormalReport(report);
    expect(output.results[0]).to.include({ action: 'error', outcome: null });
    expect(output.summary).to.include({ failed: 1, succeeded: 0, wouldDelete: 0 });
    expect(mutationExitCode(output)).to.equal(0);
  });

  it('preserves namespaced Flow identity and successful ALREADY_DELETED acknowledgement', () => {
    const report = executedNormal([
      result({
        namespace: 'billing',
        coreResult: {
          versionId: versionA,
          outcome: 'DELETED',
          reasonCode: 'ALREADY_DELETED',
          message: 'This version is already deleted.',
          evidence: [],
        },
      }),
    ]);
    report.plan.namespace = 'billing';
    const output = projectNormalReport(report);
    expect(output.flow).to.equal('billing__Invoice');
    expect(output.results[0]).to.include({
      flow: 'billing__Invoice',
      outcome: 'succeeded',
      reasonCode: 'ALREADY_DELETED',
      message: 'This version is already deleted.',
    });
    expect(output.results[0].blockingReasons).to.deep.equal([]);
    expect(output.summary.succeeded).to.equal(1);
    expect(mutationExitCode(output)).to.equal(0);
  });

  it('preserves Core errors independently from blocked versions and acknowledged successes', () => {
    const output = projectNormalReport(
      executedNormal([
        result(),
        result({
          versionId: versionB,
          versionNumber: 2,
          state: 'BLOCKED',
          targetDeleted: false,
          coreResult: {
            versionId: versionB,
            outcome: 'BLOCKED',
            reasonCode: 'LAST_VERSION',
            message: 'Keep one version.',
            evidence: [],
          },
        }),
        result({
          versionNumber: 3,
          state: 'FAILED',
          targetDeleted: false,
          error: { code: 'DELETE_ERROR', message: 'Could not delete.' },
          coreResult: {
            versionId: versionA,
            outcome: 'ERROR',
            reasonCode: 'DELETE_ERROR',
            message: 'Could not delete.',
            evidence: [],
          },
        }),
      ])
    );
    expect(output.outcome).to.equal('partial');
    expect(output.summary).to.include({ succeeded: 1, blocked: 1, failed: 1 });
    expect(output.results[1].blockingReasons[0].code).to.equal('LAST_VERSION');
    expect(output.results[2].error).to.deep.equal({ code: 'DELETE_ERROR', message: 'Could not delete.' });
    expect(mutationExitCode(output)).to.equal(68);
    expect(JSON.parse(JSON.stringify(output)) as unknown).to.deep.equal(output);
  });

  it('keeps unconfirmed and unattempted versions distinct, with unknown taking exit precedence', () => {
    const output = projectNormalReport(
      executedNormal([
        result(),
        result({
          versionNumber: 2,
          state: 'UNKNOWN',
          targetDeleted: null,
          coreResult: null,
          error: { code: 'BULK_DELETE_REQUEST_FAILED', message: 'Reconcile exact targets.' },
        }),
        result({
          versionNumber: 3,
          state: 'NOT_ATTEMPTED',
          targetDeleted: null,
          coreResult: null,
          error: { code: 'EXECUTION_STOPPED', message: 'No further mutation was sent.' },
        }),
      ])
    );
    expect(output.results.map((row) => row.outcome)).to.deep.equal(['succeeded', 'unknown', 'not_attempted']);
    expect(output.summary).to.include({ succeeded: 1, unknown: 1, notAttempted: 1, failed: 0 });
    expect(output.outcome).to.equal('unknown');
    expect(mutationExitCode(output)).to.equal(1);
  });

  it('does not infer successful deletion from state alone without a Core acknowledgement', () => {
    const output = projectNormalReport(executedNormal([result({ coreResult: null })]));
    expect(output.summary.succeeded).to.equal(0);
    expect(output.results[0].outcome).to.equal('failed');
    expect(mutationExitCode(output)).to.equal(1);
  });

  it('copies diagnostics instead of exposing mutable plan objects and merges actual warnings', () => {
    const report = normal();
    report.plan.versions[0].error = { code: 'VERSION_NOT_FOUND', message: 'Absent.' };
    report.plan.warnings = ['A warning.'];
    const before = structuredClone(report);
    const output = projectNormalReport(report);
    output.results[0].error!.message = 'Changed output only.';
    output.warnings.push('Extra output warning.');
    expect(report).to.deep.equal(before);
    const executed = executedNormal([result()]);
    executed.plan.warnings = ['A warning.'];
    executed.deletion!.warnings = ['A warning.', 'Execution warning.'];
    expect(projectNormalReport(executed).warnings).to.deep.equal(['A warning.', 'Execution warning.']);
  });

  it('keeps saved-interview force impact separate from force execution blockers', () => {
    const output = projectForceReport(force());
    expect(output.impact!.reasons[0]).to.include({ code: 'PAUSED_INTERVIEWS', count: 2 });
    expect(output.results[0]).to.include({ action: 'delete', outcome: null });
    expect(output.results[0].blockingReasons).to.deep.equal([]);
    expect(output.summary).to.include({ wouldDelete: 1, blocked: 0, succeeded: 0 });
    expect(mutationExitCode(output)).to.equal(0);
  });

  it('reports force preview blockers with unavailable counts as null', () => {
    const report = force();
    report.plan.executionBlockers = [{ code: 'EVALUATION_INCOMPLETE', message: 'Assessment did not finish.' }];
    const output = projectForceReport(report);
    expect(output.results[0].blockingReasons).to.deep.equal([
      { code: 'EVALUATION_INCOMPLETE', message: 'Assessment did not finish.', count: null },
    ]);
    expect(output.results[0].outcome).to.equal(null);
    expect(output.summary).to.include({ blocked: 1, wouldDelete: 0, succeeded: 0 });
    expect(mutationExitCode(output)).to.equal(0);
    report.dryRun = false;
    report.outcome = 'BLOCKED';
    expect(mutationExitCode(projectForceReport(report))).to.equal(1);
  });

  it('retains actual force execution metadata and errors without exposing continuation history', () => {
    const deletion = forceResult({
      state: 'BLOCKED',
      targetDeleted: false,
      reasons: [{ code: 'INSUFFICIENT_ACCESS', message: 'Permission is required.', count: 1 }],
      errors: [{ code: 'INSUFFICIENT_ACCESS', message: 'Permission is required.', detail: { retryable: false } }],
      operations: [
        {
          operationId: 'unit',
          versionId: versionA,
          outcome: 'IN_PROGRESS',
          interviewIds: [],
          scheduledWorkIds: [],
          reasons: [],
          errors: [],
          preview: null,
          hasMore: true,
        },
      ],
    });
    const output = projectForceReport(force({ dryRun: false, confirmed: true, outcome: 'BLOCKED', deletion }));
    expect(output.execution).to.deep.equal({
      operationId: 'operation-unit',
      interviewIds: ['0Fo000000000001'],
      scheduledWorkIds: ['work-unit'],
      errors: deletion.errors,
    });
    expect(output.results[0].blockingReasons).to.deep.equal([
      { code: 'INSUFFICIENT_ACCESS', message: 'Permission is required.', count: 1 },
    ]);
    expect(output.results[0].outcome).to.equal('blocked');
    expect(output.execution).not.to.have.property('operations');
    expect(output.execution).not.to.have.property('hasMore');
    output.execution!.interviewIds.push('output-only');
    output.execution!.errors.push('output-only');
    expect(deletion.interviewIds).to.have.length(1);
    expect(deletion.errors).to.have.length(1);
  });

  it('keeps actual force success, failure and uncertainty distinct', () => {
    for (const [state, expected, exit] of [
      ['DELETED', 'succeeded', 0],
      ['FAILED', 'failed', 1],
      ['UNKNOWN', 'unknown', 1],
    ] as const) {
      const output = projectForceReport(
        force({
          dryRun: false,
          confirmed: true,
          outcome: state,
          deletion: forceResult({ state, targetDeleted: state === 'DELETED' ? true : null }),
        })
      );
      expect(output.results[0].outcome).to.equal(expected);
      expect(output.outcome).to.equal(expected);
      expect(mutationExitCode(output)).to.equal(exit);
    }
  });

  it('joins org-wide retention results by exact identities rather than repeated version numbers', () => {
    const report = prune({ dryRun: false, confirmed: true, outcome: 'PARTIAL' });
    report.plan.scope = { ...report.plan.scope, all: true, flowName: null };
    report.plan.flows.push(
      retentionFlow({
        definitionId: definitionB,
        apiName: 'OtherFlow',
        versions: [retentionVersion({ versionId: versionB })],
      })
    );
    report.deletion = {
      outcome: 'PARTIAL',
      warnings: [],
      results: [
        result({
          definitionId: definitionB,
          versionId: versionB,
          flowName: 'OtherFlow',
          coreResult: { versionId: versionB, outcome: 'DELETED', reasonCode: null, message: null, evidence: [] },
        }),
        result({
          state: 'BLOCKED',
          targetDeleted: false,
          coreResult: {
            versionId: versionA,
            outcome: 'BLOCKED',
            reasonCode: 'HAS_INTERVIEWS',
            message: 'Saved interviews.',
            evidence: [],
          },
        }),
      ],
    };
    const output = projectPruneReport(report);
    expect(output.flow).to.equal(null);
    expect(output.results.map((row) => [row.flow, row.versionId, row.outcome])).to.deep.equal([
      ['Invoice', versionA, 'blocked'],
      ['OtherFlow', versionB, 'succeeded'],
    ]);
    expect(output.summary).to.include({ succeeded: 1, blocked: 1 });
    expect(mutationExitCode(output)).to.equal(68);
  });

  it('does not count protected KEPT versions as unsuccessful cleanup even when Core blocks them', () => {
    const report = prune({ dryRun: false, confirmed: true, outcome: 'SUCCEEDED' });
    report.plan.flows[0].versions.push(
      retentionVersion({
        versionId: versionB,
        versionNumber: 2,
        disposition: 'KEPT',
        outcome: 'BLOCKED',
        deletable: false,
        reasonCode: 'LAST_VERSION',
        message: 'Keep a version.',
        reasons: [
          { code: 'LATEST_N', message: 'Keep latest.' },
          { code: 'ACTIVE_VERSION', message: 'Keep Active.' },
        ],
      })
    );
    report.deletion = { outcome: 'SUCCEEDED', results: [result()], warnings: [] };
    const output = projectPruneReport(report);
    expect(output.outcome).to.equal('succeeded');
    expect(output.summary).to.include({ succeeded: 1, kept: 1, blocked: 0, failed: 0 });
    expect(output.results[1]).to.include({ action: 'keep', outcome: null, reasonCode: 'LAST_VERSION' });
    expect(output.results[1].blockingReasons).to.deep.equal([]);
    expect(output.results[1].keepReason).to.deep.equal(report.plan.flows[0].versions[1].reasons);
    expect(mutationExitCode(output)).to.equal(0);
  });

  it('includes planned blocked and assessment-error rows outside retention mutation candidates', () => {
    const report = prune({ dryRun: false, confirmed: true, outcome: 'SUCCEEDED' });
    report.plan.flows[0].versions.push(
      retentionVersion({
        versionId: versionB,
        disposition: 'BLOCKED',
        outcome: 'BLOCKED',
        deletable: false,
        reasonCode: 'HAS_INTERVIEWS',
        message: 'Saved interviews.',
        reasons: [{ code: 'HAS_INTERVIEWS', message: 'Saved interviews.' }],
      }),
      retentionVersion({
        versionId: '301xx000003Ga9EAAS',
        disposition: 'ERROR',
        reasonCode: null,
        reasons: [{ code: 'RETENTION_AGE_UNAVAILABLE', message: 'Age is not available.' }],
      })
    );
    report.deletion = { outcome: 'SUCCEEDED', results: [result()], warnings: [] };
    const output = projectPruneReport(report);
    expect(output.outcome).to.equal('partial');
    expect(output.summary).to.include({ succeeded: 1, blocked: 1, failed: 1 });
    expect(output.results[2].error).to.deep.equal({
      code: 'RETENTION_AGE_UNAVAILABLE',
      message: 'Age is not available.',
    });
    expect(mutationExitCode(output)).to.equal(68);
  });

  it('does not turn a missing retention acknowledgement into a preview or a success', () => {
    const report = prune({ dryRun: false, confirmed: true, outcome: 'SUCCEEDED' });
    report.deletion = { outcome: 'SUCCEEDED', results: [], warnings: [] };
    const output = projectPruneReport(report);
    expect(output.results[0].outcome).to.equal('unknown');
    expect(output.summary).to.include({ succeeded: 0, unknown: 1, wouldDelete: 0 });
    expect(output.outcome).to.equal('unknown');
    expect(mutationExitCode(output)).to.equal(1);
  });

  it('returns success when retention has only kept versions and no deletion is necessary', () => {
    const report = prune({ dryRun: false, outcome: 'SUCCEEDED' });
    report.plan.flows[0].versions[0].disposition = 'KEPT';
    report.plan.flows[0].versions[0].reasons = [{ code: 'LATEST_N', message: 'Keep latest.' }];
    report.deletion = { outcome: 'SUCCEEDED', results: [], warnings: [] };
    const output = projectPruneReport(report);
    expect(output.summary).to.include({ kept: 1, succeeded: 0, wouldDelete: 0 });
    expect(output.rule).to.deep.equal({ keepLatest: 5, olderThan: '90d' });
    expect(mutationExitCode(output)).to.equal(0);
  });

  it('distinguishes cancellation from an explicit timeout without changing process state', () => {
    const originalExitCode = process.exitCode;
    const report = projectNormalReport(normal());
    expect(mutationExitCode({ ...report, outcome: 'cancelled' })).to.equal(1);
    expect(mutationExitCode({ ...report, outcome: 'timed_out' })).to.equal(69);
    expect(process.exitCode).to.equal(originalExitCode);
  });
});

describe('Flow version list exit policy', () => {
  const report = (
    outcomes: Array<'PASS' | 'BLOCKED' | 'ERROR'>,
    listTruncated = false
  ): Parameters<typeof listExitCode>[0] => ({
    listTruncated,
    flows: [{ versions: outcomes.map((outcome) => ({ outcome })) }],
  });
  it('returns success for an empty list and assessed blocked rows', () => {
    expect(listExitCode(report([]))).to.equal(0);
    expect(listExitCode(report(['PASS', 'BLOCKED']))).to.equal(0);
  });
  it('returns partial for usable rows plus assessment errors or truncation', () => {
    expect(listExitCode(report(['PASS', 'ERROR']))).to.equal(68);
    expect(listExitCode(report(['BLOCKED', 'ERROR']))).to.equal(68);
    expect(listExitCode(report(['PASS'], true))).to.equal(68);
  });
  it('returns failure when there are no fully assessed rows in an incomplete result', () => {
    expect(listExitCode(report(['ERROR']))).to.equal(1);
    expect(listExitCode(report([], true))).to.equal(1);
  });
});
