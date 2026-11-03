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

import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { DependencyService, type DependencyReport } from '../../services/dependencyService.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.dependencies');

export type DependencyCommandReport = DependencyReport & { targetOrg: string; apiVersion: string };

const terminalText = (value: unknown): string => String(value).replace(/\p{Cc}/gu, ' ');

export const formatDependencyReport = (report: DependencyCommandReport): string => {
  const lines = [
    '=== Flow dependencies',
    `Target org: ${terminalText(report.targetOrg)} | API: ${report.apiVersion} | Version policy: ${
      report.versionPolicy
    }`,
    `Root: ${report.root.flowName} (v${report.root.versionNumber}, ${terminalText(report.root.status)})`,
    `Definition: ${report.root.definitionId} | Version: ${report.root.versionId}`,
  ];

  for (const direction of ['incoming', 'outgoing'] as const) {
    const relationships = report.relationships.filter((edge) => edge.direction === direction);
    lines.push('', direction === 'incoming' ? '=== Incoming references' : '=== Outgoing dependencies');
    if (relationships.length === 0) lines.push('  None reported within the inspected providers and scan scope.');
    for (const edge of relationships) {
      const version =
        edge.callerVersion === undefined ? '' : ` (v${edge.callerVersion}, ${terminalText(edge.callerStatus)})`;
      lines.push(
        `  ${terminalText(edge.callerType)}: ${terminalText(edge.callerName)}${version}`,
        `    -> ${terminalText(edge.targetType)}: ${terminalText(edge.targetName)}`,
        `    Evidence: ${terminalText(edge.evidence)}${
          edge.elementName ? ` | Element: ${terminalText(edge.elementName)}` : ''
        }`
      );
    }
  }

  return `\n${lines.join('\n')}\n`;
};

export default class Dependencies extends SfCommand<DependencyCommandReport> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'flow-name': Flags.string({ char: 'f', required: true, summary: messages.getMessage('flags.flow-name.summary') }),
    namespace: Flags.string({ summary: messages.getMessage('flags.namespace.summary') }),
    'scan-flow': Flags.string({ multiple: true, summary: messages.getMessage('flags.scan-flow.summary') }),
    'version-policy': Flags.string({
      options: ['latest', 'active'],
      default: 'latest',
      summary: messages.getMessage('flags.version-policy.summary'),
    }),
  };

  public async run(): Promise<DependencyCommandReport> {
    const { flags } = await this.parse(Dependencies);
    const conn = flags['target-org'].getConnection(flags['api-version']);
    const service = new DependencyService({
      async query<T>(soql: string): Promise<{ records: T[]; totalSize: number; done: boolean }> {
        const result = await conn.tooling.query(soql);
        return { records: result.records as T[], totalSize: result.totalSize, done: result.done };
      },
    });
    const report: DependencyCommandReport = {
      ...(await service.analyze({
        flowName: flags['flow-name'],
        namespace: flags.namespace,
        scanFlows: flags['scan-flow'],
        versionPolicy: flags['version-policy'] as 'latest' | 'active',
      })),
      targetOrg: flags['target-org'].getUsername() ?? 'authenticated org',
      apiVersion: conn.getApiVersion(),
    };
    if (!this.jsonEnabled()) this.log(formatDependencyReport(report));
    return report;
  }

  protected async catch(error: Error): Promise<never> {
    const humanOutput = !this.jsonEnabled();
    if (humanOutput) this.logToStderr('');
    try {
      return await super.catch(error);
    } finally {
      if (humanOutput) this.logToStderr('');
    }
  }
}
