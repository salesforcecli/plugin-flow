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
import { Messages, SfError } from '@salesforce/core';
import {
  ConnectFlowVersionListClient,
  FlowVersionError,
  type ConnectFlowVersionListReport,
  type ConnectFlowVersionListVersion,
} from '@salesforce/flow-node';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { formatFlowVersionTable, type FlowVersionTableRow } from '../../../ux/flowVersionTable.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.version.list');

export type FlowVersionListCommandReport = ConnectFlowVersionListReport & {
  targetOrg: string;
  apiVersion: string;
};

const terminalText = (value: unknown): string =>
  stripVTControlCharacters(String(value)).replace(/[\p{Cc}\p{Cf}]/gu, ' ');

const sdkError = (error: unknown): never => {
  if (error instanceof FlowVersionError) throw new SfError(error.message, error.code);
  throw error;
};

const tableRow = (row: ConnectFlowVersionListVersion): FlowVersionTableRow => ({
  versionName: row.versionName ?? 'Name unavailable',
  version: String(row.versionNumber),
  status: row.status ?? 'Unavailable',
  age: row.ageDays === null ? 'Unavailable' : `${row.ageDays}d`,
  creator: row.createdByName ?? 'Name unavailable',
  createdDate: row.createdDate ?? 'Unavailable',
  lastModifiedDate: row.lastModifiedDate ?? 'Unavailable',
  references: row.referenceCount === null ? 'Unavailable' : String(row.referenceCount),
  paused: row.pausedInterviewCount === null ? 'Unavailable' : String(row.pausedInterviewCount),
  failed: row.failedInterviewCount === null ? 'Unavailable' : String(row.failedInterviewCount),
  deletable: row.outcome === 'PASS' ? 'Yes' : row.outcome === 'BLOCKED' ? 'No' : 'Error',
  reason: row.outcome === 'PASS' ? '—' : row.message ?? row.reasonCode ?? 'Assessment failed',
});

export const formatVersionListReport = (report: FlowVersionListCommandReport, width?: number): string => {
  const lines = [
    '=== Flow versions',
    `Target org: ${terminalText(report.targetOrg)} | API: ${terminalText(report.apiVersion)}`,
    `Scope: ${terminalText(report.scope.all ? 'all Flows' : report.scope.flowName)}`,
  ];
  const filters = [
    report.filters.status === null ? null : `status=${terminalText(report.filters.status)}`,
    report.filters.olderThan === null ? null : `older-than=${terminalText(report.filters.olderThan)}`,
    report.filters.minPercent === null ? null : `min-percent=${report.filters.minPercent}`,
    report.filters.deletable ? 'deletable=true' : null,
  ].filter((filter): filter is string => filter !== null);
  if (filters.length > 0) lines.push(`Filters: ${filters.join(' | ')}`);
  for (const flow of report.flows) {
    const count = flow.versionCount === null ? 'count unavailable' : String(flow.versionCount);
    const percent = flow.limitPercent === null ? 'percentage unavailable' : `${flow.limitPercent}%`;
    lines.push(
      '',
      `=== ${terminalText(flow.apiName)}`,
      `Version usage: ${count}/${report.versionLimit} (${percent}) before filtering`,
      '',
      formatFlowVersionTable(flow.versions.map(tableRow), width)
    );
  }
  if (report.returnedVersionCount === 0) {
    lines.push(
      '',
      report.listTruncated
        ? 'No matching Flow versions were returned in the inspected scope; the server reports an incomplete list.'
        : 'No Flow versions match the selected scope and filters.'
    );
  }
  if (report.listTruncated) {
    lines.push(
      '',
      'Warning: The server reports a truncated list. The displayed versions are not a complete inventory.'
    );
  }
  return `\n${lines.join('\n')}\n`;
};

export default class FlowVersionList extends SfCommand<FlowVersionListCommandReport> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    flow: Flags.string({ char: 'f', exclusive: ['all'], summary: messages.getMessage('flags.flow.summary') }),
    all: Flags.boolean({ default: false, exclusive: ['flow'], summary: messages.getMessage('flags.all.summary') }),
    namespace: Flags.string({ summary: messages.getMessage('flags.namespace.summary') }),
    status: Flags.string({ summary: messages.getMessage('flags.status.summary') }),
    'older-than': Flags.string({ summary: messages.getMessage('flags.older-than.summary') }),
    'min-percent': Flags.integer({ summary: messages.getMessage('flags.min-percent.summary') }),
    deletable: Flags.boolean({ default: false, summary: messages.getMessage('flags.deletable.summary') }),
  };

  public async run(): Promise<FlowVersionListCommandReport> {
    const { flags } = await this.parse(FlowVersionList);
    if (!flags.flow && !flags.all) throw new SfError(messages.getMessage('scopeRequired'), 'FlowVersionScopeRequired');
    if (flags['min-percent'] !== undefined && (flags['min-percent'] < 0 || flags['min-percent'] > 100)) {
      throw new SfError(messages.getMessage('invalidMinPercent'), 'InvalidVersionUsagePercent');
    }
    const org = flags['target-org'];
    const connection = org.getConnection(flags['api-version']);
    const inventory = await new ConnectFlowVersionListClient(connection)
      .list({
        ...(flags.flow === undefined ? {} : { flowName: flags.flow }),
        all: flags.all,
        ...(flags.namespace === undefined ? {} : { namespace: flags.namespace }),
        ...(flags.status === undefined ? {} : { status: flags.status }),
        ...(flags['older-than'] === undefined ? {} : { olderThan: flags['older-than'] }),
        ...(flags['min-percent'] === undefined ? {} : { minPercent: flags['min-percent'] }),
        deletable: flags.deletable,
      })
      .catch(sdkError);
    const report: FlowVersionListCommandReport = {
      ...inventory,
      targetOrg: org.getUsername() ?? 'authenticated org',
      apiVersion: connection.getApiVersion(),
    };
    if (!this.jsonEnabled()) this.log(formatVersionListReport(report));
    if (report.listTruncated || report.flows.some((flow) => flow.versions.some((row) => row.outcome === 'ERROR'))) {
      process.exitCode = 1;
    }
    return report;
  }
}
