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
  outcome: FlowVersionForceDeleteResult['state'] | 'PREVIEWED' | 'CANCELLED';
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
const count = (value: number | null): string => (value === null ? 'Unavailable' : String(value));

export const forceDeleteVersionNumber = (value: string): number => {
  const number = /^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number)) throw new SfError(messages.getMessage('forceSingleVersion'), 'ForceSingleVersion');
  return number;
};

export const assertForceDeleteTerminal = (json: boolean, dryRun: boolean): void => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || (json && !dryRun && !process.stderr.isTTY)) {
    throw new SfError(messages.getMessage('forceInteractiveRequired'), 'ForceInteractiveRequired');
  }
};

export const formatVersionForceDeleteReport = (report: FlowVersionForceDeleteCommandReport): string => {
  const { plan } = report;
  const { impact } = plan;
  const flowName = impact.flowApiName ?? (plan.namespace ? `${plan.namespace}__${plan.flowName}` : plan.flowName);
  const lines = [
    '=== Flow version force deletion',
    `Target org: ${terminalText(report.targetOrg)} | API: ${terminalText(report.apiVersion)} | Mode: FORCE`,
    `Flow: ${terminalText(flowName)} | Version: ${plan.versionNumber}`,
    `Definition: ${terminalText(plan.definitionId)} | Version ID: ${terminalText(plan.versionId)}`,
    '',
    '=== Impact preview',
    `Paused interviews: ${count(impact.pausedInterviewCount)}`,
    `Failed interviews: ${count(impact.failedInterviewCount)}`,
    `Other saved interviews: ${count(impact.otherInterviewCount)}`,
    `Distinct users: ${count(impact.distinctUserCount)}`,
    `Oldest interview age: ${
      impact.oldestInterviewAgeDays === null ? 'Unavailable' : `${impact.oldestInterviewAgeDays}d`
    }`,
    `Orchestrations in progress: ${count(impact.orchestrationInProgressCount)}`,
    `Referencing Flow versions: ${count(impact.referencingVersionCount)}`,
    `Scheduled resumes within 7 days: ${
      impact.scheduledResumeWithin7Days === null
        ? 'Unavailable (not stored on the interview)'
        : count(impact.scheduledResumeWithin7Days)
    }`,
    `Work items: ${
      impact.workItemCount === null ? 'Unavailable (not keyed by Flow version)' : count(impact.workItemCount)
    }`,
  ];
  lines.push(
    '',
    `Backend eligibility: ${
      impact.eligible ? 'ELIGIBLE' : `BLOCKED | ${terminalText(impact.reasonCode ?? 'Unavailable')}`
    }`
  );
  if (plan.clientPolicyError)
    lines.push(
      '',
      `Client policy: ${terminalText(plan.clientPolicyError.code)} | ${terminalText(plan.clientPolicyError.message)}`
    );
  lines.push('', messages.getMessage('forceIrreversible'));
  if (report.deletion) {
    lines.push('', '=== Result', `Outcome: ${report.outcome}`);
    if (report.deletion.abandonedInterviewCount !== null)
      lines.push(`Abandoned interviews: ${report.deletion.abandonedInterviewCount}`);
    if (report.deletion.error)
      lines.push(`${terminalText(report.deletion.error.code)}: ${terminalText(report.deletion.error.message)}`);
    if (report.deletion.state === 'UNKNOWN') lines.push(messages.getMessage('forceUnknown'));
  } else {
    lines.push('', `Outcome: ${report.outcome}`, messages.getMessage('forceNoMutation'));
  }
  return `\n${lines.join('\n')}\n`;
};

const sdkError = (error: unknown): never => {
  if (error instanceof FlowVersionError) throw new SfError(error.message, error.code);
  throw error;
};

const confirmationWindow = (expiresAt: string | null): number => {
  const remaining = expiresAt === null ? Number.NaN : Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining < 60_000)
    throw new SfError(messages.getMessage('forcePreviewExpiring'), 'ForcePreviewExpiring');
  return Math.min(120_000, Math.floor(remaining));
};

export const runForceVersionDeletion = async (
  input: ForceDeleteCommandInput
): Promise<FlowVersionForceDeleteCommandReport> => {
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
    if (!plan.impact.eligible || plan.clientPolicyError) {
      report.outcome = 'BLOCKED';
      process.exitCode = 1;
      if (!input.json) input.display(formatVersionForceDeleteReport(report));
      return report;
    }
    assertForceDeleteTerminal(input.json, input.dryRun);
    input.display(formatVersionForceDeleteReport(report));
    if (input.yes) input.display(messages.getMessage('forceYesIgnored'));
    const flowApiName = plan.impact.flowApiName;
    if (!flowApiName || plan.impact.versionNumber !== plan.versionNumber)
      throw new SfError(messages.getMessage('forceInvalidPreview'), 'InvalidForceDeletePreview');
    const confirmed = await new ForceDeleteConfirmationPrompt().confirm({
      flowApiName,
      versionNumber: plan.versionNumber,
      flowNameMessage: messages.getMessage('forceConfirmFlow', [flowApiName]),
      versionMessage: messages.getMessage('forceConfirmVersion', [plan.versionNumber]),
      ms: confirmationWindow(plan.expiresAt),
      output: input.json ? process.stderr : process.stdout,
    });
    if (!confirmed) {
      report.outcome = 'CANCELLED';
      input.display(messages.getMessage('forceCancelled'));
      return report;
    }
    assertForceDeleteTerminal(input.json, input.dryRun);
    report.confirmed = true;
    report.confirmationMethod = 'TYPED_FLOW_AND_VERSION';
    report.deletion = await service.execute(plan).catch(sdkError);
    report.outcome = report.deletion.state;
    if (report.outcome === 'BLOCKED') process.exitCode = 1;
    else if (report.outcome !== 'SUCCEEDED') process.exitCode = 2;
    if (!input.json) input.display(formatVersionForceDeleteReport(report));
    return report;
  } finally {
    service.cancel(plan);
  }
};
