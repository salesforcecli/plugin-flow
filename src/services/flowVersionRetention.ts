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

import {
  FlowVersionDeleteService,
  FlowVersionError,
  type ConnectFlowVersionListReport,
  type ConnectFlowVersionListFlow,
  type ConnectFlowVersionListVersion,
  type FlowVersionDeleteClient,
  type FlowVersionDeleteResult,
  type FlowVersionInventory,
} from '@salesforce/flow-node';

export type RetentionPolicy = { keepLatest: number; olderThanDays: number };
export type RetentionReason = { code: string; message: string };
export type RetentionVersion = ConnectFlowVersionListVersion & {
  disposition: 'KEPT' | 'CANDIDATE' | 'BLOCKED' | 'ERROR';
  reasons: RetentionReason[];
};
export type RetentionFlow = Omit<ConnectFlowVersionListFlow, 'versions'> & { versions: RetentionVersion[] };
export type RetentionPlan = {
  orgId: string;
  generatedAt: string;
  scope: ConnectFlowVersionListReport['scope'];
  policy: RetentionPolicy;
  flows: RetentionFlow[];
};
export type RetentionExecution = {
  outcome: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'UNKNOWN';
  results: FlowVersionDeleteResult[];
  warnings: string[];
};
export type RetentionScope = { flowName?: string; all?: boolean };
export type RetentionListClient = { list(input: RetentionScope): Promise<ConnectFlowVersionListReport> };

const interimNotice =
  'Rollback protection uses the newest Obsolete statusChangeDate. Packaging can update this timestamp; the product rule remains interim.';
const statuses = new Set(['Active', 'Draft', 'Obsolete', 'InvalidDraft', 'UnderReview']);
const reason = (code: string, message: string): RetentionReason => ({ code, message });

const rollbackReason = (datedCount: number, rollbackCount: number): RetentionReason => {
  if (datedCount === 0)
    return reason(
      'ROLLBACK_TIME_UNAVAILABLE',
      'Keep all Obsolete versions because no stored status-change timestamp identifies a rollback candidate.'
    );
  if (rollbackCount > 1)
    return reason('ROLLBACK_TIME_TIE', 'Keep every Obsolete version tied for the newest statusChangeDate.');
  return reason(
    'PREVIOUSLY_ACTIVE',
    'Keep the Obsolete version with the newest statusChangeDate (interim rollback rule).'
  );
};
const stopsExecution = (row: FlowVersionDeleteResult): boolean =>
  row.state === 'UNKNOWN' ||
  row.state === 'NOT_ATTEMPTED' ||
  row.error?.code === 'ORG_MISMATCH' ||
  row.error?.code === 'ORG_CONTEXT_UNAVAILABLE';

const executionOutcome = (results: FlowVersionDeleteResult[]): RetentionExecution['outcome'] => {
  if (results.some((row) => row.state === 'UNKNOWN')) return 'UNKNOWN';
  const succeeded = results.filter((row) => row.state === 'SUCCEEDED').length;
  if (succeeded === results.length) return 'SUCCEEDED';
  return succeeded > 0 ? 'PARTIAL' : 'FAILED';
};

export const retentionPolicy = (keepLatest: number, olderThan: string): RetentionPolicy => {
  if (!Number.isSafeInteger(keepLatest) || keepLatest < 1) {
    throw new FlowVersionError('INVALID_RETENTION_POLICY', '--keep-latest must be an integer of at least 1.');
  }
  const match = /^(0|[1-9]\d*)d$/.exec(olderThan);
  const olderThanDays = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(olderThanDays) || olderThanDays > 36_500) {
    throw new FlowVersionError('INVALID_RETENTION_POLICY', '--older-than must be 0d to 36500d.');
  }
  return { keepLatest, olderThanDays };
};

/** Retention is CLI product policy; the C1 service alone supplies eligibility and source metadata. */
export const classifyRetentionFlow = (flow: ConnectFlowVersionListFlow, policy: RetentionPolicy): RetentionFlow => {
  for (const version of flow.versions) {
    if (!Object.hasOwn(version, 'statusChangeDate')) {
      throw new FlowVersionError(
        'RETENTION_METADATA_UNAVAILABLE',
        'C4 requires statusChangeDate from the Core list API. Rebuild and restart the updated backend, then preview again.'
      );
    }
  }
  const latest = new Set(
    [...flow.versions]
      .sort((left, right) => right.versionNumber - left.versionNumber)
      .slice(0, policy.keepLatest)
      .map((row) => row.versionId)
  );
  const obsolete = flow.versions.filter((row) => row.status === 'Obsolete');
  const dated = obsolete.filter((row) => row.statusChangeDate !== null);
  const newest = dated.reduce((value, row) => Math.max(value, Date.parse(row.statusChangeDate!)), -Infinity);
  const rollback = new Set(
    obsolete
      .filter((row) =>
        dated.length ? row.statusChangeDate !== null && Date.parse(row.statusChangeDate!) === newest : true
      )
      .map((row) => row.versionId)
  );
  const unknownStatus = flow.versions.some((row) => row.status === null || !statuses.has(row.status));
  return {
    ...flow,
    versions: flow.versions.map((row): RetentionVersion => {
      const reasons: RetentionReason[] = [];
      if (row.status === 'Active') reasons.push(reason('ACTIVE_VERSION', 'Keep the Active version.'));
      if (latest.has(row.versionId)) reasons.push(reason('LATEST_N', `Keep the latest ${policy.keepLatest} versions.`));
      if (rollback.has(row.versionId)) reasons.push(rollbackReason(dated.length, rollback.size));
      if (unknownStatus) {
        reasons.push(
          reason(
            'RETENTION_STATUS_UNAVAILABLE',
            'A version has no recognized status; the protected set cannot be established for this Flow.'
          )
        );
        return { ...row, disposition: 'ERROR', reasons };
      }
      if (reasons.length > 0) return { ...row, disposition: 'KEPT', reasons };
      if (row.ageDays === null)
        return {
          ...row,
          disposition: 'ERROR',
          reasons: [
            reason('RETENTION_AGE_UNAVAILABLE', 'The backend did not supply the age required by the retention rule.'),
          ],
        };
      if (row.ageDays < policy.olderThanDays)
        return {
          ...row,
          disposition: 'KEPT',
          reasons: [reason('AGE_THRESHOLD', `Keep versions younger than ${policy.olderThanDays} days.`)],
        };
      if (row.outcome === 'ERROR') {
        return {
          ...row,
          disposition: 'ERROR',
          reasons: [
            reason(
              row.reasonCode ?? 'ASSESSMENT_ERROR',
              row.message ?? row.reasonCode ?? 'The backend could not assess this version.'
            ),
          ],
        };
      }
      if (row.outcome === 'BLOCKED' || !row.deletable) {
        return {
          ...row,
          disposition: 'BLOCKED',
          reasons: [
            reason(
              row.reasonCode ?? 'BACKEND_BLOCKED',
              row.message ?? row.reasonCode ?? 'The backend reports a deletion blocker.'
            ),
          ],
        };
      }
      return {
        ...row,
        disposition: 'CANDIDATE',
        reasons: [
          reason(
            'RETENTION_CANDIDATE',
            'Inactive, outside the protected versions, old enough, and marked deletable by Core.'
          ),
        ],
      };
    }),
  };
};

/** Exact prepared targets are bound to this service and org and cannot be replayed or expanded. */
export class FlowVersionRetentionService {
  private readonly plans = new WeakMap<
    RetentionPlan,
    { snapshot: RetentionPlan; serialized: string; started: boolean }
  >();

  public constructor(
    private readonly listClient: RetentionListClient,
    private readonly deleteClient: FlowVersionDeleteClient
  ) {}

  private static localResult(
    flow: RetentionFlow,
    row: RetentionVersion,
    state: 'FAILED' | 'NOT_ATTEMPTED' | 'UNKNOWN',
    code: string,
    message: string
  ): FlowVersionDeleteResult {
    return {
      definitionId: flow.definitionId,
      versionId: row.versionId,
      flowName: flow.apiName,
      namespace: null,
      versionNumber: row.versionNumber,
      status: row.status,
      assessment: null,
      error: { code, message },
      state,
      targetDeleted: state === 'FAILED' ? false : null,
      source: 'CLIENT_POLICY',
    };
  }

  public async plan(scope: RetentionScope, policy: RetentionPolicy): Promise<RetentionPlan> {
    const selectedPolicy = retentionPolicy(policy.keepLatest, `${policy.olderThanDays}d`);
    const catalog = await this.catalog(scope);
    const plan: RetentionPlan = {
      orgId: catalog.orgId,
      generatedAt: catalog.generatedAt,
      scope: catalog.scope,
      policy: selectedPolicy,
      flows: catalog.flows.map((flow) => classifyRetentionFlow(flow, selectedPolicy)),
    };
    this.plans.set(plan, { snapshot: structuredClone(plan), serialized: JSON.stringify(plan), started: false });
    return plan;
  }

  public async execute(input: RetentionPlan): Promise<RetentionExecution> {
    const prepared = this.plans.get(input);
    if (!prepared) {
      throw new FlowVersionError('INVALID_RETENTION_PLAN', 'Prepare and confirm an unchanged plan with this service.');
    }
    if (prepared.serialized !== JSON.stringify(input)) {
      throw new FlowVersionError('INVALID_RETENTION_PLAN', 'Prepare and confirm an unchanged plan with this service.');
    }
    if (prepared.started)
      throw new FlowVersionError('RETENTION_PLAN_ALREADY_EXECUTED', 'Prepare and confirm a new retention preview.');
    this.assertOrg(prepared.snapshot.orgId);
    prepared.started = true;
    const plan = structuredClone(prepared.snapshot);
    const results: FlowVersionDeleteResult[] = [];
    const warnings = new Set([
      interimNotice,
      'Client retention checks are observations, not an atomic reservation against concurrent changes.',
    ]);
    let stopped = false;
    for (const flow of plan.flows) {
      const candidates = flow.versions
        .filter((row) => row.disposition === 'CANDIDATE')
        .sort((left, right) => left.versionNumber - right.versionNumber);
      // Prepare independently so a missing/replaced target never rejects its eligible siblings.
      for (let start = 0; start < candidates.length; start++) {
        const chunk = candidates.slice(start, start + 1);
        if (stopped) {
          for (const row of chunk)
            results.push(
              FlowVersionRetentionService.localResult(
                flow,
                row,
                'NOT_ATTEMPTED',
                'EXECUTION_STOPPED',
                'No deletion was sent because a preceding result requires reconciliation.'
              )
            );
          continue;
        }
        // C1 provides the fully qualified API name and exact definition ID. Do not guess namespace boundaries.
        const service = new FlowVersionDeleteService({
          getOrgId: (): ReturnType<FlowVersionDeleteClient['getOrgId']> => this.deleteClient.getOrgId(),
          inventory: async (): Promise<FlowVersionInventory> => {
            const current = await this.catalog({ flowName: flow.apiName }, plan.orgId);
            const exact = current.flows.find(
              (item) => item.definitionId === flow.definitionId && item.apiName === flow.apiName
            );
            if (!exact)
              throw new FlowVersionError('TARGET_CHANGED', 'The exact approved Flow definition is no longer present.');
            return {
              definitionId: exact.definitionId,
              flowName: flow.apiName,
              namespace: null,
              versions: exact.versions.map((row) => {
                if (row.status === null || !statuses.has(row.status))
                  throw new FlowVersionError('RETENTION_STATUS_UNAVAILABLE', 'Current version status is unavailable.');
                return {
                  definitionId: exact.definitionId,
                  versionId: row.versionId,
                  flowName: flow.apiName,
                  namespace: null,
                  versionNumber: row.versionNumber,
                  status: row.status,
                };
              }),
            };
          },
          assessVersions: (targets): ReturnType<FlowVersionDeleteClient['assessVersions']> =>
            this.deleteClient.assessVersions(targets),
          deleteVersion: (versionId): ReturnType<FlowVersionDeleteClient['deleteVersion']> =>
            this.deleteClient.deleteVersion(versionId),
        });
        let executionStarted = false;
        try {
          // eslint-disable-next-line no-await-in-loop -- Independent mutations must remain strictly ordered.
          const deletionPlan = await service.plan({
            flowName: flow.apiName,
            versions: chunk.map((row) => row.versionNumber).join(','),
          });
          if (
            deletionPlan.definitionId !== flow.definitionId ||
            deletionPlan.versions.some((target, index) => target.versionId !== chunk[index]?.versionId)
          ) {
            throw new FlowVersionError(
              'TARGET_CHANGED',
              'The exact approved versions changed. No replacements were selected.'
            );
          }
          executionStarted = true;
          // eslint-disable-next-line no-await-in-loop -- An uncertain result must stop every later mutation.
          const execution = await service.execute(deletionPlan, {
            beforeDelete: async (target) => {
              if (target.versionId !== chunk[0]?.versionId || target.definitionId !== flow.definitionId)
                return {
                  allowed: false,
                  code: 'TARGET_CHANGED',
                  message: 'The target differs from the exact approved version.',
                };
              const current = await this.catalog({ flowName: flow.apiName }, plan.orgId);
              const exact = current.flows.find(
                (item) => item.definitionId === flow.definitionId && item.apiName === flow.apiName
              );
              if (!exact)
                return {
                  allowed: false,
                  code: 'TARGET_CHANGED',
                  message: 'The approved definition is no longer present.',
                };
              const fresh = classifyRetentionFlow(exact, plan.policy).versions.find(
                (row) => row.versionId === target.versionId && row.versionNumber === target.versionNumber
              );
              if (!fresh)
                return {
                  allowed: false,
                  code: 'TARGET_CHANGED',
                  message: 'The exact approved version is no longer present.',
                };
              if (fresh.disposition === 'ERROR')
                throw new FlowVersionError(
                  'RETENTION_RECHECK_ERROR',
                  fresh.reasons.map((item) => item.message).join(' ')
                );
              if (fresh.disposition !== 'CANDIDATE')
                return {
                  allowed: false,
                  code: 'RETENTION_RECHECK_BLOCKED',
                  message: fresh.reasons.map((item) => item.message).join(' '),
                };
              return { allowed: true };
            },
          });
          results.push(...execution.results);
          for (const warning of execution.warnings) warnings.add(warning);
          stopped = execution.results.some(stopsExecution);
        } catch (error) {
          const detail =
            error instanceof FlowVersionError
              ? { code: error.code, message: error.message }
              : {
                  code: 'RETENTION_REVALIDATION_FAILED',
                  message:
                    'The approved retention selection could not be revalidated. No deletion was sent for this group.',
                };
          for (const row of chunk)
            results.push(
              FlowVersionRetentionService.localResult(
                flow,
                row,
                executionStarted ? 'UNKNOWN' : 'FAILED',
                detail.code,
                executionStarted
                  ? 'Execution did not return a complete report. Reconcile the selected version IDs before trying again.'
                  : detail.message
              )
            );
          stopped = executionStarted || detail.code === 'ORG_MISMATCH' || detail.code === 'ORG_CONTEXT_UNAVAILABLE';
        }
      }
    }
    return { outcome: executionOutcome(results), results, warnings: [...warnings] };
  }

  private async catalog(scope: RetentionScope, expectedOrg?: string): Promise<ConnectFlowVersionListReport> {
    const orgId = expectedOrg ?? this.deleteClient.getOrgId();
    this.assertOrg(orgId);
    const report = await this.listClient.list(scope);
    this.assertOrg(orgId);
    if (report.orgId !== orgId)
      throw new FlowVersionError('ORG_MISMATCH', 'The list response belongs to a different org.');
    if (!report.catalogComplete)
      throw new FlowVersionError(
        'RETENTION_CATALOG_INCOMPLETE',
        'Cleanup requires the complete unfiltered C1 catalog. No deletion was sent.'
      );
    return report;
  }

  private assertOrg(expected: string): void {
    if (this.deleteClient.getOrgId() !== expected)
      throw new FlowVersionError('ORG_MISMATCH', 'The authenticated org changed. No further deletion was sent.');
  }
}

export const retentionInterimNotice = interimNotice;
