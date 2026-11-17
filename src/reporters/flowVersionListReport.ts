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

import { stripVTControlCharacters } from 'node:util';
import { Ux } from '@salesforce/sf-plugins-core';
import type { ConnectFlowVersionListReport, ConnectFlowVersionListVersion } from '@salesforce/flow-node';
import type { PublicBlockingReason } from './flowVersionReasons.js';

/** API version facts retained under their original names for console and JSON output. */
export type FlowVersionListResultVersion = {
  versionNumber: number;
  status: string | null;
  versionName: string | null;
  createdDate: string | null;
  lastModifiedDate: string | null;
  createdByName: string | null;
  ageDays: number | null;
  runInMode: string | null;
  apiVersion: string | null;
  capacityCategory: string | null;
  areMetricsLoggedToDataCloud: boolean | null;
  pausedInterviewCount: number | null;
  failedInterviewCount: number | null;
  autosavedInterviewCount: number | null;
  savedInterviewCount: number | null;
  deletable: boolean;
  outcome: ConnectFlowVersionListVersion['outcome'];
  reasonCode: string | null;
  message: string | null;
  blockingReasons: PublicBlockingReason[];
  error?: string;
};

export type FlowVersionListResultFlow = {
  flow: string;
  versionCount: number | null;
  versionLimit: number;
  /** Unavailable if the catalog or any version's eligibility could not be assessed. */
  deletableCount: number | null;
  versions?: FlowVersionListResultVersion[];
};

export type FlowVersionListCommandResult = { flows: FlowVersionListResultFlow[] };

export type FlowVersionListPresentationOptions = {
  /** Set for the detailed single-Flow view; omitted for the org summary. */
  flowName?: string;
  olderThanDays?: number;
  deletable?: boolean;
  /** One captured instant for a consistent strict Last Modified Date cutoff. */
  now?: number;
};

const projectVersion = (version: ConnectFlowVersionListVersion): FlowVersionListResultVersion => {
  const reason: PublicBlockingReason | null =
    version.outcome === 'BLOCKED' && version.reasonCode !== null
      ? {
          code: version.reasonCode === 'HAS_INTERVIEWS' ? 'INTERVIEWS' : version.reasonCode,
          ...(version.message === null ? {} : { message: version.message }),
          ...(version.reasonCode === 'HAS_INTERVIEWS' ? { count: version.savedInterviewCount ?? null } : {}),
        }
      : null;
  return {
    versionNumber: version.versionNumber,
    status: version.status,
    versionName: version.versionName,
    createdDate: version.createdDate,
    lastModifiedDate: version.lastModifiedDate,
    createdByName: version.createdByName,
    ageDays: version.ageDays,
    runInMode: version.runInMode ?? null,
    apiVersion: version.apiVersion ?? null,
    capacityCategory: version.capacityCategory ?? null,
    areMetricsLoggedToDataCloud: version.areMetricsLoggedToDataCloud ?? null,
    pausedInterviewCount: version.pausedInterviewCount,
    failedInterviewCount: version.failedInterviewCount,
    autosavedInterviewCount: version.autosavedInterviewCount ?? null,
    savedInterviewCount: version.savedInterviewCount ?? null,
    deletable: version.deletable,
    outcome: version.outcome,
    reasonCode: version.reasonCode,
    message: version.message,
    blockingReasons: reason === null ? [] : [reason],
    ...(version.outcome === 'ERROR' ? { error: version.message ?? version.reasonCode ?? 'Assessment failed.' } : {}),
  };
};

export const projectVersionList = (
  report: ConnectFlowVersionListReport,
  options: FlowVersionListPresentationOptions = {}
): FlowVersionListCommandResult => {
  const cutoff =
    options.olderThanDays === undefined ? null : (options.now ?? Date.now()) - options.olderThanDays * 86_400_000;
  const flows = report.flows.map((flow): FlowVersionListResultFlow => {
    const complete =
      report.catalogComplete &&
      flow.versionCount === flow.versions.length &&
      !flow.versions.some((version) => version.outcome === 'ERROR');
    const versions = flow.versions
      .filter((version) => {
        if (cutoff !== null) {
          const modified = version.lastModifiedDate === null ? Number.NaN : Date.parse(version.lastModifiedDate);
          if (!Number.isFinite(modified) || modified >= cutoff) return false;
        }
        return !options.deletable || version.outcome === 'PASS';
      })
      .sort((left, right) => right.versionNumber - left.versionNumber)
      .map(projectVersion);
    return {
      flow: flow.apiName,
      versionCount: flow.versionCount,
      versionLimit: report.versionLimit,
      deletableCount: complete ? flow.versions.filter((version) => version.outcome === 'PASS').length : null,
      ...(options.flowName === undefined ? {} : { versions }),
    };
  });
  flows.sort(
    (left, right) => (right.versionCount ?? -1) - (left.versionCount ?? -1) || left.flow.localeCompare(right.flow)
  );
  return { flows };
};

const safeText = (value: unknown): string => stripVTControlCharacters(String(value)).replace(/[\p{Cc}\p{Cf}]/gu, ' ');
const available = (value: unknown): string => safeText(value ?? 'Unavailable');
const cell = (value: unknown): string => (value == null ? '' : safeText(value));
const date = (value: string | null): string => (value === null ? '' : value.slice(0, 10));
const reasonText = (version: FlowVersionListResultVersion): string => {
  if (version.reasonCode === 'HAS_INTERVIEWS')
    return version.savedInterviewCount === null ? 'INTERVIEWS' : `INTERVIEWS (${version.savedInterviewCount})`;
  return cell(version.reasonCode);
};

/** Org summaries stay compact; a one-Flow table includes every requested API field. */
export const formatVersionListResult = (
  report: FlowVersionListCommandResult,
  targetOrg: string,
  flowName?: string
): string => {
  const ux = new Ux({ jsonEnabled: false });
  if (flowName === undefined) {
    const table = ux.makeTable({
      data: report.flows.map((flow) => ({
        flow: safeText(flow.flow),
        versions: available(flow.versionCount),
        deletable: available(flow.deletableCount),
      })),
      columns: [
        { key: 'flow', name: 'Flow', overflow: 'wrap' },
        { key: 'versions', name: 'Versions' },
        { key: 'deletable', name: 'Deletable' },
      ],
      overflow: 'wrap',
    });
    return `\nFlows in ${safeText(targetOrg)} by version count\n${report.flows.length ? table : 'No Flows found.'}\n`;
  }
  const flow = report.flows[0];
  const versions = flow?.versions ?? [];
  const title = flow
    ? `${safeText(flow.flow)} in ${safeText(targetOrg)} has ${available(flow.versionCount)} of ${
        flow.versionLimit
      } versions.`
    : `${safeText(flowName)} in ${safeText(targetOrg)}`;
  const table = ux.makeTable({
    data: versions.map((version) => ({
      version: String(version.versionNumber),
      status: cell(version.status),
      name: cell(version.versionName),
      created: date(version.createdDate),
      modified: date(version.lastModifiedDate),
      creator: cell(version.createdByName),
      age: version.ageDays === null ? '' : `${version.ageDays}d`,
      runInMode: cell(version.runInMode),
      apiVersion: cell(version.apiVersion),
      capacityCategory: cell(version.capacityCategory),
      metrics: version.areMetricsLoggedToDataCloud === null ? '' : version.areMetricsLoggedToDataCloud ? 'Yes' : 'No',
      paused: cell(version.pausedInterviewCount),
      failed: cell(version.failedInterviewCount),
      autosaved: cell(version.autosavedInterviewCount),
      saved: cell(version.savedInterviewCount),
      deletable: version.outcome === 'ERROR' ? 'Error' : version.deletable ? 'Yes' : 'No',
      reason: reasonText(version),
    })),
    columns: [
      { key: 'version', name: 'Version' },
      { key: 'status', name: 'Status', width: 14, overflow: 'wrap' },
      { key: 'name', name: 'Flow Version Name', width: 26, overflow: 'wrap' },
      { key: 'created', name: 'Created' },
      { key: 'modified', name: 'Last Modified' },
      { key: 'creator', name: 'Created By', width: 24, overflow: 'wrap' },
      { key: 'age', name: 'Age' },
      { key: 'runInMode', name: 'Run in Mode', width: 24, overflow: 'wrap' },
      { key: 'apiVersion', name: 'API Version' },
      { key: 'capacityCategory', name: 'Capacity Category', width: 20, overflow: 'wrap' },
      { key: 'metrics', name: 'Log Metrics to Data Cloud' },
      { key: 'paused', name: 'Paused' },
      { key: 'failed', name: 'Failed' },
      { key: 'autosaved', name: 'Autosaved' },
      { key: 'saved', name: 'Saved Interviews' },
      { key: 'deletable', name: 'Deletable' },
      { key: 'reason', name: 'Reason', width: 32, overflow: 'wrap' },
    ],
    // Keep all 17 columns rather than collapsing or truncating facts to fit a narrow terminal.
    maxWidth: 'none',
    overflow: 'wrap',
  });
  return `\n${title}\n${versions.length ? table : 'No Flow versions match the selected filters.'}\n`;
};
