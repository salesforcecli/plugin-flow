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
  FlowVersionDeleteService,
  ConnectToolingFlowVersionDeleteClient,
  FlowVersionError,
  type FlowVersionDeleteExecutionReport,
  type FlowVersionDeletePlan,
  type FlowVersionDeleteTarget,
} from '@salesforce/flow-node';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { ConfirmationPrompt } from '../../../ux/confirmation.js';
import {
  assertForceDeleteTerminal,
  forceDeleteVersionNumber,
  runForceVersionDeletion,
  type FlowVersionForceDeleteCommandReport,
} from '../../../services/flowVersionForceDeletion.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.version.delete');

export type FlowVersionDeleteCommandReport = {
  contractVersion: '2';
  mode: 'NORMAL';
  targetOrg: string;
  apiVersion: string;
  dryRun: boolean;
  confirmed: boolean;
  outcome: FlowVersionDeleteExecutionReport['outcome'] | 'PREVIEWED' | 'CANCELLED';
  plan: FlowVersionDeletePlan;
  deletion: FlowVersionDeleteExecutionReport | null;
};

type ArgumentFlag = { type: 'option' | 'boolean'; char?: string; aliases?: readonly string[] };

const normalizeVersionDeleteArgv = (argv: string[], flags: Record<string, ArgumentFlag>): string[] => {
  const bareOptions = new Set(['target-org', 'flow', 'versions', 'namespace', 'api-version']);
  const longFlags = new Map<string, ArgumentFlag>();
  const shortFlags = new Map<string, ArgumentFlag>();
  for (const [name, flag] of Object.entries(flags)) {
    longFlags.set(name, flag);
    for (const alias of flag.aliases ?? []) longFlags.set(alias, flag);
    if (flag.char) shortFlags.set(flag.char, flag);
  }
  const normalized: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--') {
      normalized.push(...argv.slice(index));
      break;
    }
    let consumesValue = false;
    if (bareOptions.has(token)) {
      normalized.push(`--${token}`);
      consumesValue = true;
    } else {
      normalized.push(token);
      if (token.startsWith('--')) {
        consumesValue = !token.includes('=') && longFlags.get(token.slice(2))?.type === 'option';
      } else if (token.startsWith('-')) {
        const characters = token.slice(1);
        for (let position = 0; position < characters.length; position++) {
          const flag = shortFlags.get(characters[position]);
          if (!flag) break;
          if (flag.type === 'option') {
            consumesValue = position === characters.length - 1;
            break;
          }
        }
      }
    }
    if (consumesValue && index + 1 < argv.length) normalized.push(argv[++index]);
  }
  return normalized;
};

const terminalText = (value: unknown): string =>
  stripVTControlCharacters(String(value)).replace(/[\p{Cc}\p{Cf}]/gu, ' ');

const sdkError = (error: unknown): never => {
  if (error instanceof FlowVersionError) throw new SfError(error.message, error.code);
  throw error;
};

const assessmentDetails = (target: FlowVersionDeleteTarget): string[] => {
  const lines: string[] = [];
  if (target.error) {
    lines.push(`    ${terminalText(target.error.code)}: ${terminalText(target.error.message)}`);
  } else if (target.assessment && target.assessment.outcome !== 'PASS') {
    lines.push(`    ${terminalText(target.assessment.message ?? target.assessment.reasonCode ?? 'Assessment error')}`);
  }
  for (const evidence of target.assessment?.evidence ?? []) {
    const name = evidence.detailsRedacted ? 'Details unavailable' : evidence.sourceName ?? evidence.sourceId;
    lines.push(`    Reference: ${terminalText(evidence.sourceType)} | ${terminalText(name)}`);
  }
  return lines;
};

export const formatVersionDeleteReport = (report: FlowVersionDeleteCommandReport): string => {
  const lines = [
    '=== Flow version deletion',
    `Target org: ${terminalText(report.targetOrg)} | API: ${terminalText(report.apiVersion)} | Mode: NORMAL`,
    `Flow: ${report.plan.namespace ? `${terminalText(report.plan.namespace)}__` : ''}${terminalText(
      report.plan.flowName
    )}`,
    `Definition: ${terminalText(report.plan.definitionId)}`,
    '',
    report.deletion ? '=== Results' : '=== Selected versions',
  ];
  if (report.deletion) {
    for (const result of report.deletion.results) {
      lines.push(`  v${result.versionNumber} | ${terminalText(result.versionId ?? 'Not resolved')} | ${result.state}`);
      if (result.source === 'CLIENT_POLICY')
        lines.push('    Source: Client version-preservation safeguard (product policy pending)');
      lines.push(...assessmentDetails(result));
    }
  } else {
    for (const version of report.plan.versions) {
      const assessment = version.assessment?.outcome ?? (version.error ? 'RESOLUTION FAILED' : 'Not assessed');
      lines.push(
        `  v${version.versionNumber} | ${terminalText(version.versionId ?? 'Not resolved')} | ${terminalText(
          version.status ?? 'Status unavailable'
        )} | ${assessment}`
      );
      lines.push(...assessmentDetails(version));
    }
  }
  lines.push('', `Outcome: ${report.outcome}`);
  for (const warning of report.deletion?.warnings ?? report.plan.warnings) {
    lines.push(`Warning: ${terminalText(warning)}`);
  }
  if (report.dryRun) lines.push(messages.getMessage('dryRunNotice'));
  return `\n${lines.join('\n')}\n`;
};

export default class FlowVersionDelete extends SfCommand<
  FlowVersionDeleteCommandReport | FlowVersionForceDeleteCommandReport
> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly strict = false;

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    flow: Flags.string({ char: 'f', required: true, summary: messages.getMessage('flags.flow.summary') }),
    versions: Flags.string({ required: true, summary: messages.getMessage('flags.versions.summary') }),
    namespace: Flags.string({ summary: messages.getMessage('flags.namespace.summary') }),
    'dry-run': Flags.boolean({ default: false, summary: messages.getMessage('flags.dry-run.summary') }),
    yes: Flags.boolean({ char: 'y', default: false, summary: messages.getMessage('flags.yes.summary') }),
    force: Flags.boolean({ default: false, summary: messages.getMessage('flags.force.summary') }),
  };

  public async run(): Promise<FlowVersionDeleteCommandReport | FlowVersionForceDeleteCommandReport> {
    const { flags } = await this.parse(
      {
        flags: FlowVersionDelete.flags,
        baseFlags: FlowVersionDelete.baseFlags,
        enableJsonFlag: FlowVersionDelete.enableJsonFlag,
        strict: true,
      },
      normalizeVersionDeleteArgv(this.argv, {
        ...FlowVersionDelete.baseFlags,
        ...FlowVersionDelete.flags,
        json: { type: 'boolean' },
      })
    );
    if (flags.force) {
      const versionNumber = forceDeleteVersionNumber(flags.versions);
      const json = this.jsonEnabled();
      assertForceDeleteTerminal(json, flags['dry-run']);
      const org = flags['target-org'];
      return runForceVersionDeletion({
        connection: org.getConnection(flags['api-version']),
        targetOrg: org.getUsername() ?? 'authenticated org',
        flowName: flags.flow,
        versionNumber,
        namespace: flags.namespace,
        dryRun: flags['dry-run'],
        yes: flags.yes,
        json,
        display: (message: string): void => (json ? this.logToStderr(message) : this.log(message)),
      });
    }
    if (!flags['dry-run'] && !flags.yes && (this.jsonEnabled() || !process.stdin.isTTY)) {
      throw new SfError(messages.getMessage('confirmationRequired'), 'ConfirmationRequired');
    }
    const org = flags['target-org'];
    const connection = org.getConnection(flags['api-version']);
    const service = new FlowVersionDeleteService(new ConnectToolingFlowVersionDeleteClient(connection));
    const plan = await service
      .plan({ flowName: flags.flow, versions: flags.versions, namespace: flags.namespace })
      .catch(sdkError);
    const report: FlowVersionDeleteCommandReport = {
      contractVersion: '2',
      mode: 'NORMAL',
      targetOrg: org.getUsername() ?? 'authenticated org',
      apiVersion: connection.getApiVersion(),
      dryRun: flags['dry-run'],
      confirmed: false,
      outcome: 'PREVIEWED',
      plan,
      deletion: null,
    };
    if (report.dryRun) {
      if (!this.jsonEnabled()) this.log(formatVersionDeleteReport(report));
      return report;
    }
    if (!flags.yes) {
      this.log(formatVersionDeleteReport(report));
      const confirmed = await new ConfirmationPrompt().confirm({
        message: messages.getMessage('confirmDelete', [plan.versions.length, report.targetOrg]),
        ms: 60_000,
        defaultAnswer: false,
      });
      if (!confirmed) {
        report.outcome = 'CANCELLED';
        this.log(messages.getMessage('cancelled'));
        return report;
      }
    }
    report.confirmed = true;
    report.deletion = await service.execute(plan).catch(sdkError);
    report.outcome = report.deletion.outcome;
    if (report.deletion.results.some((result) => ['FAILED', 'UNKNOWN', 'NOT_ATTEMPTED'].includes(result.state))) {
      process.exitCode = 2;
    } else if (report.deletion.results.some((result) => result.state === 'BLOCKED')) {
      process.exitCode = 1;
    }
    if (!this.jsonEnabled()) this.log(formatVersionDeleteReport(report));
    return report;
  }
}
