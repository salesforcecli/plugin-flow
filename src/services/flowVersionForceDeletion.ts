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
import { Messages, SfError, type Connection } from '@salesforce/core';
import {
  ConnectFlowVersionForceDeleteClient,
  FlowVersionForceDeleteService,
  FlowVersionError,
  type FlowVersionForceDeletePlan,
  type FlowVersionForceDeleteResult,
} from '@salesforce/flow-node';
import { ForceDeleteConfirmationPrompt } from '../ux/forceDeleteConfirmation.js';
import { ConfirmationTimeoutError } from '../ux/confirmationTimeout.js';
import { mutationExitCode, projectForceReport } from '../reporters/flowVersionMutationReport.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.version.delete');

export type FlowVersionForceDeleteCommandReport = {
  contractVersion: '1';
  mode: 'FORCE';
  targetOrg: string;
  apiVersion: string;
  dryRun: boolean;
  confirmed: boolean;
  confirmationMethod: 'TYPED_FLOW_AND_VERSION' | null;
  outcome: FlowVersionForceDeleteResult['state'] | 'PREVIEWED' | 'CANCELLED' | 'TIMED_OUT';
  plan: FlowVersionForceDeletePlan;
  deletion: FlowVersionForceDeleteResult | null;
};

export type ForceDeleteCommandInput = {
  connection: Connection;
  targetOrg: string;
  flowName: string;
  versionNumber: number;
  namespace?: string;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  display: (message: string) => void;
};

const terminalText = (value: unknown): string =>
  stripVTControlCharacters(String(value)).replace(/[\p{Cc}\p{Cf}]/gu, ' ');
const nullableText = (value: string | null): string => (value === null ? 'Not supplied' : terminalText(value));
const detailText = (value: unknown): string => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const detail = value as Record<string, unknown>;
    if (typeof detail.code === 'string' && typeof detail.message === 'string')
      return terminalText(`${detail.code}: ${detail.message}`);
  }
  return terminalText(typeof value === 'string' ? value : JSON.stringify(value));
};

const reasonLines = (reasons: FlowVersionForceDeletePlan['impact']['reasons']): string[] =>
  reasons.flatMap((reason) => {
    const count = reason.count == null ? '' : ` (${reason.count})`;
    const message = reason.message == null ? '' : `: ${terminalText(reason.message)}`;
    return [
      `  ${terminalText(reason.code)}${count}${message}`,
      ...(reason.relatedResources ?? []).map((resource) => `    Related resource: ${detailText(resource)}`),
    ];
  });

export const forceDeleteVersionNumber = (value: string): number => {
  const number = /^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number)) throw messages.createError('error.forceSingleVersion', [], [], 2);
  return number;
};

export const assertForceDeleteTerminal = (json: boolean): void => {
  if (json) throw messages.createError('error.forceJsonUnsupported', [], [], 2);
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw messages.createError('error.forceInteractiveRequired', [], [], 2);
  }
};

export const formatVersionForceDeleteReport = (report: FlowVersionForceDeleteCommandReport): string => {
  const { plan } = report;
  const { impact } = plan;
  const lines = [
    '=== Flow version force deletion',
    `Target org: ${terminalText(report.targetOrg)} | API: ${terminalText(report.apiVersion)} | Mode: FORCE`,
    `Flow: ${nullableText(impact.flowApiName)} | Version: ${plan.versionNumber} | Status: ${nullableText(
      impact.versionStatus
    )}`,
    `Definition: ${terminalText(plan.definitionId)} | Version ID: ${terminalText(plan.versionId)}`,
    '',
    '=== Impact preview',
    `Preview deletable: ${impact.deletable} | Evaluation complete: ${impact.evaluationComplete}`,
    `Coverage: ${terminalText(impact.coverage)} | Eligibility advisory: ${impact.eligibilityIsAdvisory}`,
    `Interview count lower bound: ${impact.interviewCountLowerBound} | Interview list truncated: ${impact.interviewsTruncated}`,
    '',
    'Reasons:',
  ];
  if (impact.reasons.length === 0) lines.push('  None reported.');
  lines.push(...reasonLines(impact.reasons));
  lines.push('', 'Interviews:');
  if (impact.interviews.length === 0) lines.push('  None returned.');
  for (const interview of impact.interviews)
    lines.push(
      `  ${terminalText(interview.id)} | Status: ${nullableText(interview.status)} | Label: ${nullableText(
        interview.label
      )}`,
      `    Created: ${nullableText(interview.createdDate)} | Owner: ${nullableText(interview.ownerId)}`
    );
  lines.push(
    '',
    `Force execution request: ${plan.executionBlockers.length === 0 ? 'Allowed by preview checks' : 'Blocked'}`
  );
  for (const blocker of plan.executionBlockers)
    lines.push(`  ${terminalText(blocker.code)}: ${terminalText(blocker.message)}`);
  lines.push('', messages.getMessage('forceIrreversible'));
  if (report.deletion) {
    const deletion = report.deletion;
    lines.push('', '=== Result', `Outcome: ${report.outcome}`);
    if (deletion.operationId !== null) lines.push(`Operation: ${terminalText(deletion.operationId)}`);
    lines.push(...reasonLines(deletion.reasons));
    for (const error of deletion.errors) lines.push(`  Error: ${detailText(error)}`);
    if (deletion.error) lines.push(`${terminalText(deletion.error.code)}: ${terminalText(deletion.error.message)}`);
    if (deletion.interviewIds.length > 0)
      lines.push(`Reported interview IDs: ${deletion.interviewIds.map(terminalText).join(', ')}`);
    if (deletion.scheduledWorkIds.length > 0)
      lines.push(`Reported scheduled work IDs: ${deletion.scheduledWorkIds.map(terminalText).join(', ')}`);
    if (deletion.state === 'UNKNOWN') lines.push(messages.getMessage('forceUnknown'));
  } else {
    lines.push('', `Outcome: ${report.outcome}`, messages.getMessage('forceNoMutation'));
  }
  return `\n${lines.join('\n')}\n`;
};

const sdkError = (error: unknown): never => {
  if (error instanceof FlowVersionError) {
    const exitCode = error.code === 'INVALID_IDENTIFIER' || error.code === 'INVALID_SELECTION' ? 2 : 1;
    throw new SfError(error.message, error.code, undefined, exitCode);
  }
  throw error;
};

export const runForceVersionDeletion = async (
  input: ForceDeleteCommandInput
): Promise<FlowVersionForceDeleteCommandReport> => {
  assertForceDeleteTerminal(input.json);
  const service = new FlowVersionForceDeleteService(new ConnectFlowVersionForceDeleteClient(input.connection));
  const plan = await service
    .preview({ flowName: input.flowName, versionNumber: input.versionNumber, namespace: input.namespace })
    .catch(sdkError);
  const report: FlowVersionForceDeleteCommandReport = {
    contractVersion: '1',
    mode: 'FORCE',
    targetOrg: input.targetOrg,
    apiVersion: input.connection.getApiVersion(),
    dryRun: input.dryRun,
    confirmed: false,
    confirmationMethod: null,
    outcome: 'PREVIEWED',
    plan,
    deletion: null,
  };
  try {
    if (input.dryRun) {
      if (!input.json) input.display(formatVersionForceDeleteReport(report));
      return report;
    }
    if (plan.executionBlockers.length > 0) {
      report.outcome = 'BLOCKED';
      process.exitCode = mutationExitCode(projectForceReport(report));
      if (!input.json) input.display(formatVersionForceDeleteReport(report));
      return report;
    }
    assertForceDeleteTerminal(input.json);
    input.display(formatVersionForceDeleteReport(report));
    if (input.yes) input.display(messages.getMessage('forceYesIgnored'));
    const flowApiName = plan.impact.flowApiName;
    if (!flowApiName || plan.impact.versionNumber !== plan.versionNumber)
      throw new SfError(messages.getMessage('forceInvalidPreview'), 'InvalidForceDeletePreview');
    let confirmed: boolean;
    try {
      confirmed = await new ForceDeleteConfirmationPrompt().confirm({
        flowApiName,
        versionNumber: plan.versionNumber,
        flowNameMessage: messages.getMessage('forceConfirmFlow', [flowApiName]),
        versionMessage: messages.getMessage('forceConfirmVersion', [plan.versionNumber]),
        ms: 120_000,
        output: process.stdout,
      });
    } catch (error) {
      if (!(error instanceof ConfirmationTimeoutError)) throw error;
      report.outcome = 'TIMED_OUT';
      process.exitCode = mutationExitCode(projectForceReport(report));
      input.display(messages.getMessage('forceConfirmationTimedOut'));
      return report;
    }
    if (!confirmed) {
      report.outcome = 'CANCELLED';
      process.exitCode = mutationExitCode(projectForceReport(report));
      input.display(messages.getMessage('forceCancelled'));
      return report;
    }
    assertForceDeleteTerminal(input.json);
    report.confirmed = true;
    report.confirmationMethod = 'TYPED_FLOW_AND_VERSION';
    const controller = new AbortController();
    const interrupt = (): void => controller.abort();
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
      report.deletion = await service
        .execute(plan, {
          signal: controller.signal,
          onProgress: (operation): void => {
            input.display(
              `Force deletion IN_PROGRESS | Operation: ${terminalText(
                operation.operationId
              )} | Version ID: ${terminalText(operation.versionId)}`
            );
          },
        })
        .catch(sdkError);
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    }
    report.outcome = report.deletion.state;
    process.exitCode = mutationExitCode(projectForceReport(report));
    if (!input.json) input.display(formatVersionForceDeleteReport(report));
    return report;
  } finally {
    service.cancel(plan);
  }
};
