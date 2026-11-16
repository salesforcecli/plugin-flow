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
import { Messages } from '@salesforce/core';
import type { FlowVersionPruneJobStatus } from '@salesforce/flow-node';
import { Ux } from '@salesforce/sf-plugins-core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.version.job.report');

export type FlowVersionJobVersionResult = {
  flowApiName: string | null;
  versionId: string;
  outcome: 'DELETED' | 'BLOCKED' | 'FAILED' | 'NOT ASSESSED';
  reason: string | null;
};

export type ParsedFlowVersionJobResult = {
  truncated: boolean;
  versions: FlowVersionJobVersionResult[];
  warnings: string[];
  notes: string[];
};

export type FlowVersionJobReport = ParsedFlowVersionJobResult & {
  jobId: string;
  jobStatus: FlowVersionPruneJobStatus;
  /** Compatibility alias for the original status-only report. */
  status: FlowVersionPruneJobStatus;
  error: string | null;
  targetOrg: string;
  apiVersion: string;
};

const versionLine = /^(\S+) ([A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?) (NOT ASSESSED|DELETED|BLOCKED|FAILED)(?: (\S+))?$/;
const selectionWarning = 'PRUNE selection stopped before every version was read';
const selectionLimitWarning = 'PRUNE stopped after 500 versions; run the job again for the rest';
const noVersions = 'PRUNE selected no versions';
const truncationMarker = 'result truncated';
// Only used to recognize a final reason cut in half by Core's character limit.
// Complete lines retain their server reason codes without applying deletion policy here.
const completeReasons = new Set([
  'NOT_FOUND',
  'INSUFFICIENT_PERMISSION',
  'DIFFERENT_FLOW',
  'ACTIVE_VERSION',
  'STATUS_NOT_DELETABLE',
  'PACKAGED_VERSION',
  'HAS_INTERVIEWS',
  'HAS_WAIT_CONDITIONS',
  'LAST_VERSION',
  'DELETE_ERROR',
  'OPERATIONAL',
]);
const text = (value: string): string => stripVTControlCharacters(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ');

/** Parse only explicit Core facts. Job completion never supplies a missing version outcome. */
export const parseFlowVersionJobResult = (result: string | null): ParsedFlowVersionJobResult => {
  const parsed: ParsedFlowVersionJobResult = { truncated: false, versions: [], warnings: [], notes: [] };
  const lines = (result ?? '').trimEnd().split(/\r?\n/);
  parsed.truncated = lines.at(-1) === truncationMarker;
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue;
    if (line === selectionWarning || line === selectionLimitWarning || line === truncationMarker) {
      parsed.warnings.push(line);
      continue;
    }
    if (line === noVersions) {
      parsed.notes.push(line);
      continue;
    }
    const match = versionLine.exec(line);
    const reason = match?.[4];
    const incompleteReason =
      parsed.truncated && index === lines.length - 2 && reason !== undefined && !completeReasons.has(reason);
    if (!match || incompleteReason) {
      // Core can truncate within a line. Keep that text visible without fabricating a version result.
      parsed.warnings.push(messages.getMessage('unrecognizedResultLine', [line]));
      continue;
    }
    const [, source, versionId, outcome] = match;
    parsed.versions.push({
      flowApiName: source === 'DELETE' || source === 'BULK_DELETE' ? null : source,
      versionId,
      outcome: outcome as FlowVersionJobVersionResult['outcome'],
      reason: reason ?? null,
    });
  }
  return parsed;
};

/** Console and JSON use the same report; only console rendering removes terminal controls. */
export const formatFlowVersionJobReport = (report: FlowVersionJobReport): string => {
  const lines = [
    messages.getMessage('title'),
    messages.getMessage('job', [text(report.jobId)]),
    messages.getMessage('status', [report.jobStatus]),
    messages.getMessage('target', [text(report.targetOrg), text(report.apiVersion)]),
  ];
  if (report.jobStatus === 'Error')
    lines.push(
      '',
      messages.getMessage('jobError', [
        text(report.error?.trim() ? report.error : messages.getMessage('missingJobError')),
      ])
    );
  if (report.versions.length > 0) {
    const ux = new Ux({ jsonEnabled: false });
    lines.push(
      '',
      ux.makeTable({
        data: report.versions.map((version) => ({
          flowApiName: text(version.flowApiName ?? ''),
          versionId: version.versionId,
          outcome: version.outcome,
          reason: text(version.reason ?? ''),
        })),
        columns: [
          { key: 'flowApiName', name: messages.getMessage('columns.flow'), overflow: 'wrap' },
          { key: 'versionId', name: messages.getMessage('columns.version'), overflow: 'wrap' },
          { key: 'outcome', name: messages.getMessage('columns.outcome'), overflow: 'wrap' },
          { key: 'reason', name: messages.getMessage('columns.reason'), overflow: 'wrap' },
        ],
        overflow: 'wrap',
      })
    );
  }
  for (const note of report.notes) lines.push('', text(note));
  for (const warning of report.warnings) lines.push('', messages.getMessage('warning', [text(warning)]));
  return `\n${lines.join('\n')}\n`;
};
