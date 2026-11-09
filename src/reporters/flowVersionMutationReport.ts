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

import type {
  FlowVersionDeleteResult,
  FlowVersionDeleteTarget,
  FlowVersionForceDeleteImpact,
  FlowVersionForceDeleteResult,
} from '@salesforce/flow-node';
import type { FlowVersionDeleteCommandReport } from '../commands/flow/version/delete.js';
import type { FlowVersionPruneCommandReport } from '../commands/flow/version/prune.js';
import type { FlowVersionForceDeleteCommandReport } from '../services/flowVersionForceDeletion.js';
import { retentionInterimNotice, type RetentionVersion } from '../services/flowVersionRetention.js';

export type VersionActionReason = { code: string; message: string | null; count: number | null };
export type VersionActionError = { code: string; message: string };
export type VersionActionResult = {
  flow: string;
  definitionId: string | null;
  versionId: string | null;
  versionNumber: number;
  status: string | null;
  action: 'delete' | 'keep' | 'blocked' | 'error';
  outcome: 'succeeded' | 'blocked' | 'failed' | 'unknown' | 'not_attempted' | null;
  /** Actual acknowledgement/assessment details, including successful ALREADY_DELETED. */
  reasonCode: string | null;
  message: string | null;
  blockingReasons: VersionActionReason[];
  error: VersionActionError | null;
  keepReason: Array<{ code: string; message: string }>;
};
export type FlowVersionMutationSummary = {
  succeeded: number;
  blocked: number;
  failed: number;
  unknown: number;
  notAttempted: number;
  kept: number;
  wouldDelete: number;
};
export type FlowVersionMutationReport = {
  contractVersion: '3';
  mode: 'NORMAL' | 'FORCE' | 'RETENTION';
  targetOrg: string;
  apiVersion: string;
  flow: string | null;
  dryRun: boolean;
  confirmed: boolean;
  outcome: 'previewed' | 'succeeded' | 'partial' | 'blocked' | 'failed' | 'unknown' | 'cancelled' | 'timed_out';
  results: VersionActionResult[];
  summary: FlowVersionMutationSummary;
  rule: { keepLatest: number; olderThan: string } | null;
  impact: FlowVersionForceDeleteImpact | null;
  /** Acknowledged force-execution metadata, without prepared plans or continuation history. */
  execution: {
    operationId: string | null;
    interviewIds: string[];
    scheduledWorkIds: string[];
    errors: FlowVersionForceDeleteResult['errors'];
  } | null;
  warnings: string[];
};

const flowName = (name: string, namespace: string | null): string => (namespace ? `${namespace}__${name}` : name);

const copyError = (error: VersionActionError | null): VersionActionError | null =>
  error === null ? null : { ...error };

const reasons = (code: string | null, message: string | null): VersionActionReason[] =>
  code === null ? [] : [{ code, message, count: null }];

const targetRow = (target: FlowVersionDeleteTarget): VersionActionResult => ({
  flow: flowName(target.flowName, target.namespace),
  definitionId: target.definitionId,
  versionId: target.versionId,
  versionNumber: target.versionNumber,
  status: target.status,
  action: 'delete',
  outcome: null,
  reasonCode: target.assessment?.reasonCode ?? null,
  message: target.assessment?.message ?? null,
  blockingReasons: [],
  error: null,
  keepReason: [],
});

const previewTarget = (target: FlowVersionDeleteTarget, requireAssessment: boolean): VersionActionResult => {
  const row = targetRow(target);
  if (target.error || target.assessment?.outcome === 'ERROR') {
    row.action = 'error';
    row.error =
      copyError(target.error) ??
      (target.assessment?.reasonCode !== null && target.assessment?.reasonCode !== undefined
        ? { code: target.assessment.reasonCode, message: target.assessment.message ?? target.assessment.reasonCode }
        : null);
  } else if (target.assessment?.outcome === 'BLOCKED') {
    row.action = 'blocked';
    row.blockingReasons = reasons(row.reasonCode, row.message);
  } else if (requireAssessment && target.assessment?.outcome !== 'PASS') {
    // An unassessed observation is not an eligible preview candidate.
    row.action = 'error';
  }
  return row;
};

const targetBlockingReasons = (target: FlowVersionDeleteResult): VersionActionReason[] => {
  const blocker = target.coreResult ?? target.error ?? target.assessment;
  return reasons(
    blocker && 'reasonCode' in blocker ? blocker.reasonCode : blocker?.code ?? null,
    blocker?.message ?? null
  );
};

const executedTarget = (target: FlowVersionDeleteResult): VersionActionResult => {
  const row = targetRow(target);
  row.reasonCode = target.coreResult?.reasonCode ?? null;
  row.message = target.coreResult?.message ?? null;
  if (target.state === 'UNKNOWN') {
    row.outcome = 'unknown';
    row.error = copyError(target.error);
  } else if (target.state === 'NOT_ATTEMPTED') {
    row.action = 'error';
    row.outcome = 'not_attempted';
    row.error = copyError(target.error);
  } else if (target.coreResult?.outcome === 'DELETED') {
    row.outcome = 'succeeded';
  } else if (target.coreResult?.outcome === 'BLOCKED' || target.state === 'BLOCKED') {
    row.action = 'blocked';
    row.outcome = 'blocked';
    row.blockingReasons = targetBlockingReasons(target);
  } else {
    row.action = 'error';
    row.outcome = 'failed';
    row.error =
      copyError(target.error) ??
      (row.reasonCode === null ? null : { code: row.reasonCode, message: row.message ?? row.reasonCode });
  }
  return row;
};

/** In preview, blocked/failed summarize assessments; succeeded only counts deletion acknowledgements. */
const summarize = (rows: VersionActionResult[]): FlowVersionMutationSummary => {
  const summary: FlowVersionMutationSummary = {
    succeeded: 0,
    blocked: 0,
    failed: 0,
    unknown: 0,
    notAttempted: 0,
    kept: 0,
    wouldDelete: 0,
  };
  for (const row of rows) {
    if (row.outcome === 'succeeded') summary.succeeded++;
    else if (row.outcome === 'unknown') summary.unknown++;
    else if (row.outcome === 'not_attempted') summary.notAttempted++;
    else if (row.outcome === 'blocked') summary.blocked++;
    else if (row.outcome === 'failed') summary.failed++;
    else if (row.action === 'keep') summary.kept++;
    else if (row.action === 'delete') summary.wouldDelete++;
    else if (row.action === 'blocked') summary.blocked++;
    else if (row.action === 'error') summary.failed++;
  }
  return summary;
};

const overallOutcome = (
  sourceOutcome: string,
  summary: FlowVersionMutationSummary,
  dryRun: boolean,
  executed: boolean
): FlowVersionMutationReport['outcome'] => {
  if (sourceOutcome === 'TIMED_OUT') return 'timed_out';
  if (sourceOutcome === 'CANCELLED') return 'cancelled';
  if (dryRun || sourceOutcome === 'PREVIEWED') return 'previewed';
  if (sourceOutcome === 'UNKNOWN' || summary.unknown > 0) return 'unknown';
  if (summary.failed > 0 || summary.notAttempted > 0) return summary.succeeded > 0 ? 'partial' : 'failed';
  if (summary.blocked > 0) return summary.succeeded > 0 ? 'partial' : 'blocked';
  if (sourceOutcome === 'FAILED') return 'failed';
  return executed ? 'succeeded' : 'previewed';
};

/** Return data only; SfCommand owns its standard status/result/warnings JSON envelope. */
export const projectNormalReport = (report: FlowVersionDeleteCommandReport): FlowVersionMutationReport => {
  const results = report.deletion
    ? report.deletion.results.map(executedTarget)
    : report.plan.versions.map((target) => previewTarget(target, report.dryRun));
  const summary = summarize(results);
  if (report.deletion === null) {
    // A selected but unassessed target is not an eligible would-delete candidate.
    summary.wouldDelete = report.plan.versions.filter(
      (target) => target.error === null && target.assessment?.outcome === 'PASS'
    ).length;
  }
  return {
    contractVersion: '3',
    mode: 'NORMAL',
    targetOrg: report.targetOrg,
    apiVersion: report.apiVersion,
    flow: flowName(report.plan.flowName, report.plan.namespace),
    dryRun: report.dryRun,
    confirmed: report.confirmed,
    outcome: overallOutcome(report.outcome, summary, report.dryRun, report.deletion !== null),
    results,
    summary,
    rule: null,
    impact: null,
    execution: null,
    warnings: [...new Set([...report.plan.warnings, ...(report.deletion?.warnings ?? [])])],
  };
};

const forceRow = (report: FlowVersionForceDeleteCommandReport): VersionActionResult => {
  const deletion = report.deletion;
  const firstReason = deletion?.reasons[0];
  const row: VersionActionResult = {
    flow: flowName(report.plan.flowName, report.plan.namespace),
    definitionId: report.plan.definitionId,
    versionId: report.plan.versionId,
    versionNumber: report.plan.versionNumber,
    status: report.plan.impact.versionStatus,
    action: 'delete',
    outcome: null,
    reasonCode: firstReason?.code ?? null,
    message: firstReason?.message ?? null,
    blockingReasons: [],
    error: copyError(deletion?.error ?? null),
    keepReason: [],
  };
  if (deletion?.state === 'DELETED') row.outcome = 'succeeded';
  else if (deletion?.state === 'UNKNOWN') row.outcome = 'unknown';
  else if (deletion?.state === 'FAILED') {
    row.action = 'error';
    row.outcome = 'failed';
  } else if (deletion?.state === 'BLOCKED') {
    row.action = 'blocked';
    row.outcome = 'blocked';
    row.blockingReasons = deletion.reasons.map((reason) => ({
      code: reason.code,
      message: reason.message ?? null,
      count: reason.count ?? null,
    }));
    if (row.blockingReasons.length === 0 && deletion.error)
      row.blockingReasons = reasons(deletion.error.code, deletion.error.message);
  } else if (report.plan.executionBlockers.length > 0) {
    row.action = 'blocked';
    row.outcome = report.outcome === 'BLOCKED' ? 'blocked' : null;
    row.blockingReasons = report.plan.executionBlockers.map((blocker) => ({ ...blocker, count: null }));
  }
  return row;
};

export const projectForceReport = (report: FlowVersionForceDeleteCommandReport): FlowVersionMutationReport => {
  const row = forceRow(report);
  const deletion = report.deletion;
  const results = [row];
  const summary = summarize(results);
  return {
    contractVersion: '3',
    mode: 'FORCE',
    targetOrg: report.targetOrg,
    apiVersion: report.apiVersion,
    flow: row.flow,
    dryRun: report.dryRun,
    confirmed: report.confirmed,
    outcome: overallOutcome(report.outcome, summary, report.dryRun, deletion !== null),
    results,
    summary,
    rule: null,
    impact: structuredClone(deletion?.preview ?? report.plan.impact),
    execution:
      deletion === null
        ? null
        : {
            operationId: deletion.operationId,
            interviewIds: [...deletion.interviewIds],
            scheduledWorkIds: [...deletion.scheduledWorkIds],
            errors: structuredClone(deletion.errors),
          },
    warnings: [],
  };
};

const retentionRow = (flow: string, definitionId: string, version: RetentionVersion): VersionActionResult => ({
  flow,
  definitionId,
  versionId: version.versionId,
  versionNumber: version.versionNumber,
  status: version.status,
  action:
    version.disposition === 'KEPT'
      ? 'keep'
      : version.disposition === 'BLOCKED'
      ? 'blocked'
      : version.disposition === 'ERROR'
      ? 'error'
      : 'delete',
  outcome: null,
  reasonCode: version.reasonCode,
  message: version.message,
  blockingReasons:
    version.disposition === 'BLOCKED' ? version.reasons.map((reason) => ({ ...reason, count: null })) : [],
  error:
    version.disposition === 'ERROR'
      ? (version.reasons.at(-1) ? { ...version.reasons.at(-1)! } : null) ??
        (version.reasonCode === null
          ? null
          : {
              code: version.reasonCode,
              message: version.message ?? version.reasonCode,
            })
      : null,
  keepReason: version.disposition === 'KEPT' ? version.reasons.map((reason) => ({ ...reason })) : [],
});

export const projectPruneReport = (report: FlowVersionPruneCommandReport): FlowVersionMutationReport => {
  const key = (definitionId: string, versionId: string | null): string => `${definitionId}:${versionId ?? ''}`;
  const execution = new Map(
    (report.deletion?.results ?? []).map((result) => [key(result.definitionId, result.versionId), result])
  );
  const results: VersionActionResult[] = [];
  for (const flow of report.plan.flows) {
    for (const version of flow.versions) {
      const identity = key(flow.definitionId, version.versionId);
      const result = execution.get(identity);
      if (result) {
        results.push(executedTarget(result));
        execution.delete(identity);
      } else {
        const row = retentionRow(flow.apiName, flow.definitionId, version);
        if (report.deletion !== null && row.action !== 'keep') {
          if (row.action === 'blocked') row.outcome = 'blocked';
          else if (row.action === 'error') row.outcome = 'failed';
          // Missing acknowledgement leaves an approved candidate uncertain, never successful.
          else row.outcome = 'unknown';
        }
        results.push(row);
      }
    }
  }
  // Do not discard an actual execution acknowledgement even if a malformed caller omitted its plan row.
  results.push(...[...execution.values()].map(executedTarget));
  const summary = summarize(results);
  return {
    contractVersion: '3',
    mode: 'RETENTION',
    targetOrg: report.targetOrg,
    apiVersion: report.apiVersion,
    flow: report.plan.scope.all ? null : report.plan.scope.flowName,
    dryRun: report.dryRun,
    confirmed: report.confirmed,
    outcome: overallOutcome(report.outcome, summary, report.dryRun, report.deletion !== null),
    results,
    summary,
    rule: { keepLatest: report.plan.policy.keepLatest, olderThan: `${report.plan.policy.olderThanDays}d` },
    impact: null,
    execution: null,
    warnings: [...new Set([retentionInterimNotice, ...(report.deletion?.warnings ?? [])])],
  };
};

/** CLI guide conventions; unknown mutation acknowledgements take precedence over partial success. */
export const mutationExitCode = (report: FlowVersionMutationReport): 0 | 1 | 2 | 68 | 69 => {
  if (report.outcome === 'timed_out') return 69;
  if (report.outcome === 'cancelled') return 1;
  if (report.dryRun || report.outcome === 'previewed') return 0;
  if (report.outcome === 'unknown' || report.summary.unknown > 0) return 1;
  const unsuccessful = report.summary.blocked + report.summary.failed + report.summary.notAttempted;
  if (report.summary.succeeded > 0 && unsuccessful > 0) return 68;
  if (unsuccessful > 0 || report.outcome === 'blocked' || report.outcome === 'failed') return 1;
  return 0;
};

/** A partially read/assessed list retains its rows but exits nonzero. Blocked rows are assessed data. */
export const listExitCode = (report: {
  listTruncated: boolean;
  flows: Array<{ versions: Array<{ outcome: 'PASS' | 'BLOCKED' | 'ERROR' }> }>;
}): 0 | 1 | 68 => {
  const rows = report.flows.flatMap((flow) => flow.versions);
  if (!report.listTruncated && !rows.some((row) => row.outcome === 'ERROR')) return 0;
  return rows.some((row) => row.outcome !== 'ERROR') ? 68 : 1;
};
