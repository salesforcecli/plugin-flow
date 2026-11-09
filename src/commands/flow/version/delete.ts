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
  ConnectFlowVersionDeleteClient,
  FlowVersionError,
  type FlowVersionDeleteExecutionReport,
  type FlowVersionDeletePlan,
  type FlowVersionDeleteTarget,
} from '@salesforce/flow-node';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { ConfirmationPrompt } from '../../../ux/confirmation.js';
import { ConfirmationTimeoutError } from '../../../ux/confirmationTimeout.js';
import {
  projectNormalReport,
  projectForceReport,
  mutationExitCode,
  type FlowVersionMutationReport,
} from '../../../reporters/flowVersionMutationReport.js';
import {
  assertForceDeleteTerminal,
  forceDeleteVersionNumber,
  runForceVersionDeletion,
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
  outcome: FlowVersionDeleteExecutionReport['outcome'] | 'PREVIEWED' | 'CANCELLED' | 'TIMED_OUT';
  plan: FlowVersionDeletePlan;
  deletion: FlowVersionDeleteExecutionReport | null;
};

export type FlowVersionDeleteCommandResult = FlowVersionMutationReport;

type ArgumentFlag = {
  type: 'option' | 'boolean';
  char?: string;
  aliases?: readonly string[];
  charAliases?: readonly string[];
};

const normalizeVersionDeleteArgv = (argv: string[], flags: Record<string, ArgumentFlag>): string[] => {
  const bareOptions = new Set(['target-org', 'flow', 'versions', 'namespace', 'api-version']);
  const longFlags = new Map<string, ArgumentFlag>();
  const shortFlags = new Map<string, ArgumentFlag>();
  for (const [name, flag] of Object.entries(flags)) {
    longFlags.set(name, flag);
    for (const alias of flag.aliases ?? []) longFlags.set(alias, flag);
    if (flag.char) shortFlags.set(flag.char, flag);
    for (const alias of flag.charAliases ?? []) shortFlags.set(alias, flag);
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
  if (error instanceof FlowVersionError) {
    const usageCodes = new Set(['INVALID_IDENTIFIER', 'INVALID_SELECTION', 'SELECTION_TOO_LARGE']);
    throw new SfError(error.message, error.code, undefined, usageCodes.has(error.code) ? 2 : 1);
  }
  throw error;
};

const reasonDetails = (code: string | null, message: string | null): string[] => {
  if (code === null && message === null) return [];
  const detail = code === null ? message! : message && message !== code ? `${code}: ${message}` : code;
  return [`    ${terminalText(detail)}`];
};

const assessmentDetails = (target: FlowVersionDeleteTarget): string[] => {
  if (target.error) return reasonDetails(target.error.code, target.error.message);
  if (target.assessment && target.assessment.outcome !== 'PASS')
    return reasonDetails(target.assessment.reasonCode, target.assessment.message);
  return [];
};

const formattedFlowName = (plan: FlowVersionDeletePlan): string =>
  plan.namespace ? `${terminalText(plan.namespace)}__${terminalText(plan.flowName)}` : terminalText(plan.flowName);

export const formatVersionDeleteReport = (
  report: FlowVersionDeleteCommandReport,
  displayOutcome: string = report.outcome
): string => {
  const lines = [
    '=== Flow version deletion',
    `Target org: ${terminalText(report.targetOrg)} | API: ${terminalText(report.apiVersion)} | Mode: NORMAL`,
    `Flow: ${formattedFlowName(report.plan)}`,
    `Definition: ${terminalText(report.plan.definitionId)}`,
    '',
    report.deletion ? '=== Results' : '=== Selected versions',
  ];
  if (report.deletion) {
    for (const result of report.deletion.results) {
      const core = result.coreResult;
      lines.push(
        `  v${result.versionNumber} | ${terminalText(result.versionId ?? 'Not resolved')} | ${
          core?.outcome ?? result.state
        }`
      );
      if (result.source === 'CLIENT_POLICY') lines.push('    Source: Client policy');
      lines.push(...(core ? reasonDetails(core.reasonCode, core.message) : assessmentDetails(result)));
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
  lines.push('', `Outcome: ${displayOutcome}`);
  for (const warning of report.deletion?.warnings ?? report.plan.warnings) {
    lines.push(`Warning: ${terminalText(warning)}`);
  }
  if (report.dryRun) lines.push(messages.getMessage('dryRunNotice'));
  return `\n${lines.join('\n')}\n`;
};

export default class FlowVersionDelete extends SfCommand<FlowVersionDeleteCommandResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly strict = false;

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    flow: Flags.string({ char: 'f', required: true, summary: messages.getMessage('flags.flow.summary') }),
    versions: Flags.string({
      required: true,
      multiple: true,
      multipleNonGreedy: true,
      summary: messages.getMessage('flags.versions.summary'),
    }),
    namespace: Flags.string({ summary: messages.getMessage('flags.namespace.summary') }),
    'dry-run': Flags.boolean({ default: false, summary: messages.getMessage('flags.dry-run.summary') }),
    'no-prompt': Flags.boolean({
      char: 'p',
      aliases: ['yes'],
      charAliases: ['y'],
      deprecateAliases: true,
      default: false,
      summary: messages.getMessage('flags.no-prompt.summary'),
    }),
    force: Flags.boolean({ default: false, summary: messages.getMessage('flags.force.summary') }),
  };

  public async run(): Promise<FlowVersionDeleteCommandResult> {
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
    const json = this.jsonEnabled();
    const approved = flags['no-prompt'];
    if (flags.force) {
      if (flags.versions.length !== 1) throw messages.createError('error.forceSingleVersion', [], [], 2);
      const versionNumber = forceDeleteVersionNumber(flags.versions[0]);
      assertForceDeleteTerminal(json);
      const org = flags['target-org'];
      const internalReport = await runForceVersionDeletion({
        connection: org.getConnection(flags['api-version']),
        targetOrg: org.getUsername() ?? 'authenticated org',
        flowName: flags.flow,
        versionNumber,
        namespace: flags.namespace,
        dryRun: flags['dry-run'],
        yes: approved,
        json,
        display: (message: string): void => this.log(message),
      });
      const result = projectForceReport(internalReport);
      process.exitCode = mutationExitCode(result);
      return result;
    }
    const canPrompt = !json && process.stdin.isTTY === true && process.stdout.isTTY === true;
    const dryRun = flags['dry-run'] || (!approved && !canPrompt);
    const org = flags['target-org'];
    const connection = org.getConnection(flags['api-version']);
    const service = new FlowVersionDeleteService(new ConnectFlowVersionDeleteClient(connection));
    const plan = await service
      .plan(
        { flowName: flags.flow, versions: flags.versions.join(','), namespace: flags.namespace },
        { preview: dryRun }
      )
      .catch(sdkError);
    const report: FlowVersionDeleteCommandReport = {
      contractVersion: '2',
      mode: 'NORMAL',
      targetOrg: org.getUsername() ?? 'authenticated org',
      apiVersion: connection.getApiVersion(),
      dryRun,
      confirmed: false,
      outcome: 'PREVIEWED',
      plan,
      deletion: null,
    };
    const finish = (): FlowVersionMutationReport => {
      const result = projectNormalReport(report);
      process.exitCode = mutationExitCode(result);
      return result;
    };
    if (report.dryRun) {
      if (!json) this.log(formatVersionDeleteReport(report));
      return finish();
    }
    if (!approved) {
      this.log(formatVersionDeleteReport(report));
      let confirmed: boolean;
      try {
        confirmed = await new ConfirmationPrompt().confirm({
          message: messages.getMessage('confirmDelete', [plan.versions.length, report.targetOrg]),
          ms: 60_000,
          defaultAnswer: false,
        });
      } catch (error) {
        if (!(error instanceof ConfirmationTimeoutError)) throw error;
        report.outcome = 'TIMED_OUT';
        this.log(messages.getMessage('confirmationTimedOut'));
        return finish();
      }
      if (!confirmed) {
        report.outcome = 'CANCELLED';
        this.log(messages.getMessage('cancelled'));
        return finish();
      }
    }
    report.confirmed = true;
    report.deletion = await service.execute(plan).catch(sdkError);
    report.outcome = report.deletion.outcome;
    const result = finish();
    if (!json) this.log(formatVersionDeleteReport(report, result.outcome));
    return result;
  }
}
