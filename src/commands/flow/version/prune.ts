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
  ConnectFlowVersionDeleteClient,
  FlowVersionError,
  type FlowVersionDeleteResult,
} from '@salesforce/flow-node';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { ConfirmationPrompt } from '../../../ux/confirmation.js';
import { ConfirmationTimeoutError } from '../../../ux/confirmationTimeout.js';
import {
  mutationExitCode,
  projectPruneReport,
  type FlowVersionMutationReport,
} from '../../../reporters/flowVersionMutationReport.js';
import {
  FlowVersionRetentionService,
  retentionPolicy,
  retentionInterimNotice,
  type RetentionPlan,
  type RetentionExecution,
  type RetentionPolicy,
  type RetentionVersion,
} from '../../../services/flowVersionRetention.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.version.prune');

export type FlowVersionPruneCommandReport = {
  contractVersion: '1';
  mode: 'RETENTION';
  targetOrg: string;
  apiVersion: string;
  dryRun: boolean;
  confirmed: boolean;
  outcome: RetentionExecution['outcome'] | 'PREVIEWED' | 'CANCELLED' | 'TIMED_OUT';
  plan: RetentionPlan;
  deletion: RetentionExecution | null;
};

const text = (value: unknown): string => stripVTControlCharacters(String(value)).replace(/[\p{Cc}\p{Cf}]/gu, ' ');
const sdkError = (error: unknown): never => {
  if (error instanceof FlowVersionError) throw new SfError(error.message, error.code);
  throw error;
};

const versionLines = (row: RetentionVersion): string[] => {
  const lines = [
    `  v${row.versionNumber} | ${text(row.status ?? 'Status unavailable')} | Age: ${
      row.ageDays === null ? 'Unavailable' : `${row.ageDays}d`
    } | ${row.disposition}`,
    `    ${row.reasons.map((item) => `${text(item.code)}: ${text(item.message)}`).join(' ')}`,
  ];
  if (row.status === 'Obsolete')
    lines.push(`    Status changed: ${text(row.statusChangeDate ?? 'No stored timestamp')}`);
  if (row.outcome !== 'PASS')
    lines.push(`    Core: ${row.outcome} | ${text(row.message ?? row.reasonCode ?? 'Assessment error')}`);
  return lines;
};
const resultLines = (result: FlowVersionDeleteResult): string[] => {
  const core = result.coreResult;
  const lines = [`  ${text(result.flowName)} v${result.versionNumber} | ${core?.outcome ?? result.state}`];
  if (core) {
    const detail = [core.reasonCode, core.message]
      .filter((value) => value !== null)
      .map(text)
      .join(': ');
    if (detail) lines.push(`    ${detail}`);
  } else if (result.error) {
    lines.push(`    ${text(result.error.code)}: ${text(result.error.message)}`);
  }
  return lines;
};

export const formatVersionPruneReport = (
  report: FlowVersionPruneCommandReport,
  displayOutcome: string = report.outcome
): string => {
  const lines = [
    '=== Flow version retention cleanup',
    `Target org: ${text(report.targetOrg)} | API: ${text(report.apiVersion)}`,
    `Policy: keep Active, latest ${report.plan.policy.keepLatest}, and interim rollback candidates; age >= ${report.plan.policy.olderThanDays}d`,
    `Mode: ${report.dryRun ? 'Preview' : 'Execute'}`,
  ];
  for (const flow of report.plan.flows) {
    lines.push('', `=== ${text(flow.apiName)}`, `Definition: ${text(flow.definitionId)}`);
    for (const row of flow.versions) lines.push(...versionLines(row));
  }
  if (report.plan.flows.length === 0) lines.push('', 'No Flow versions were returned.');
  if (report.deletion) {
    lines.push('', '=== Deletion results');
    for (const result of report.deletion.results) lines.push(...resultLines(result));
  }
  const candidates = report.plan.flows
    .flatMap((flow) => flow.versions)
    .filter((row) => row.disposition === 'CANDIDATE').length;
  lines.push('', `Cleanup candidates: ${candidates}`, `Outcome: ${displayOutcome}`, retentionInterimNotice);
  if (report.dryRun || !report.confirmed) lines.push('No deletion requests were sent.');
  else for (const warning of report.deletion?.warnings ?? []) lines.push(`Warning: ${text(warning)}`);
  return `\n${lines.join('\n')}\n`;
};

export default class FlowVersionPrune extends SfCommand<FlowVersionMutationReport> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    flow: Flags.string({ char: 'f', exclusive: ['all'], summary: messages.getMessage('flags.flow.summary') }),
    all: Flags.boolean({ default: false, exclusive: ['flow'], summary: messages.getMessage('flags.all.summary') }),
    'keep-latest': Flags.integer({ default: 5, summary: messages.getMessage('flags.keep-latest.summary') }),
    'older-than': Flags.string({ default: '90d', summary: messages.getMessage('flags.older-than.summary') }),
    'dry-run': Flags.boolean({ default: false, summary: messages.getMessage('flags.dry-run.summary') }),
    execute: Flags.boolean({ default: false, summary: messages.getMessage('flags.execute.summary') }),
    'no-prompt': Flags.boolean({
      char: 'p',
      aliases: ['yes'],
      charAliases: ['y'],
      deprecateAliases: true,
      default: false,
      summary: messages.getMessage('flags.no-prompt.summary'),
    }),
  };

  public async run(): Promise<FlowVersionMutationReport> {
    const { flags } = await this.parse(FlowVersionPrune);
    if (!flags.flow && !flags.all) throw messages.createError('error.scopeRequired', [], [], 2);
    const policy = ((): RetentionPolicy => {
      try {
        return retentionPolicy(flags['keep-latest'], flags['older-than']);
      } catch (error) {
        if (error instanceof FlowVersionError && error.code === 'INVALID_RETENTION_POLICY') {
          throw messages.createError('error.invalidRetentionPolicy', [error.message], [], 2);
        }
        return sdkError(error);
      }
    })();
    const json = this.jsonEnabled();
    const approved = flags['no-prompt'];
    const canPrompt = !json && process.stdin.isTTY === true && process.stdout.isTTY === true;
    const dryRun = flags['dry-run'] || !(flags.execute || approved) || (!approved && !canPrompt);
    const org = flags['target-org'];
    const connection = org.getConnection(flags['api-version']);
    const service = new FlowVersionRetentionService(
      new ConnectFlowVersionListClient(connection),
      new ConnectFlowVersionDeleteClient(connection)
    );
    const plan = await service
      .plan({ ...(flags.flow ? { flowName: flags.flow } : { all: true }) }, policy)
      .catch(sdkError);
    const report: FlowVersionPruneCommandReport = {
      contractVersion: '1',
      mode: 'RETENTION',
      targetOrg: org.getUsername() ?? 'authenticated org',
      apiVersion: connection.getApiVersion(),
      dryRun,
      confirmed: false,
      outcome: 'PREVIEWED',
      plan,
      deletion: null,
    };
    const finish = (display = true): FlowVersionMutationReport => {
      const result = projectPruneReport(report);
      process.exitCode = mutationExitCode(result);
      if (display && !json) this.log(formatVersionPruneReport(report, result.outcome.toUpperCase()));
      return result;
    };
    if (report.dryRun) return finish();

    const count = plan.flows.flatMap((flow) => flow.versions).filter((row) => row.disposition === 'CANDIDATE').length;
    if (!approved && count > 0) {
      this.log(formatVersionPruneReport(report));
      let confirmed: boolean;
      try {
        confirmed = await new ConfirmationPrompt().confirm({
          message: messages.getMessage('confirmPrune', [count, report.targetOrg]),
          ms: 60_000,
          defaultAnswer: false,
        });
      } catch (error) {
        if (!(error instanceof ConfirmationTimeoutError)) throw error;
        report.outcome = 'TIMED_OUT';
        this.log(messages.getMessage('timedOut'));
        return finish(false);
      }
      if (!confirmed) {
        report.outcome = 'CANCELLED';
        this.log(messages.getMessage('cancelled'));
        return finish(false);
      }
    }
    report.confirmed = count > 0;
    report.deletion = await service.execute(plan).catch(sdkError);
    report.outcome = report.deletion.outcome;
    return finish();
  }
}
