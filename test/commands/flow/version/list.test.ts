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

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import Ajv from 'ajv';
import { expect } from 'chai';
import sinon from 'sinon';
import { run as runCli } from '@oclif/core';
import { Org, SfError } from '@salesforce/core';
import {
  ConnectFlowVersionListClient,
  FlowVersionError,
  FlowVersionService,
  type ConnectFlowVersionListReport,
} from '@salesforce/flow-node';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import FlowVersionList, {
  formatVersionListReport,
  type FlowVersionListCommandReport,
} from '../../../../src/commands/flow/version/list.js';
import {
  projectVersionList,
  type FlowVersionListCommandResult,
} from '../../../../src/reporters/flowVersionListReport.js';
import { ConfirmationPrompt } from '../../../../src/ux/confirmation.js';
import { formatFlowVersionTable, type FlowVersionTableRow } from '../../../../src/ux/flowVersionTable.js';

const reportFixture = (): ConnectFlowVersionListReport => ({
  contractVersion: '1',
  orgId: '00D000000000001EAA',
  generatedAt: '2026-10-27T12:00:00.000Z',
  scope: { all: false, flowName: 'Invoice_Approval', namespace: null, allNamespaces: false },
  filters: { status: null, olderThan: null, minPercent: null, deletable: false },
  versionLimit: 25,
  returnedVersionCount: 1,
  candidateVersionCount: 3,
  listTruncated: false,
  catalogComplete: false,
  nextOffset: null,
  flows: [
    {
      definitionId: '300xx000000bojNAAQ',
      apiName: 'Invoice_Approval',
      label: 'Invoice Approval',
      versionCount: 3,
      limitPercent: 12,
      versions: [
        {
          versionId: '301xx000003Ga19AAC',
          versionNumber: 2,
          versionName: 'Invoice Approval - Review',
          status: 'Draft',
          createdDate: '2026-10-01T12:00:00.000Z',
          ageDays: 26,
          createdById: '005000000000001AAA',
          createdByName: 'Flow Author',
          lastModifiedDate: '2026-10-02T12:00:00.000Z',
          runInMode: 'DefaultMode',
          apiVersion: '66.0',
          capacityCategory: 'Default',
          areMetricsLoggedToDataCloud: false,
          referenceCount: null,
          pausedInterviewCount: 0,
          failedInterviewCount: 0,
          autosavedInterviewCount: 0,
          savedInterviewCount: 0,
          deletable: true,
          outcome: 'PASS',
          reasonCode: null,
          message: null,
        },
      ],
    },
  ],
});
const commandReportFixture = (report = reportFixture()): FlowVersionListCommandReport => ({
  ...report,
  targetOrg: 'poc@example.com',
  apiVersion: '67.0',
});
const blocked = (report: ConnectFlowVersionListReport, message = 'This version has saved interviews.'): void => {
  Object.assign(report.flows[0].versions[0], {
    outcome: 'BLOCKED',
    deletable: false,
    reasonCode: 'HAS_INTERVIEWS',
    message,
    referenceCount: null,
    pausedInterviewCount: 2,
    failedInterviewCount: 1,
    autosavedInterviewCount: 7,
    savedInterviewCount: 10,
  });
};
const errored = (report: ConnectFlowVersionListReport): void => {
  Object.assign(report.flows[0].versions[0], {
    outcome: 'ERROR',
    deletable: false,
    reasonCode: 'OPERATIONAL',
    message: null,
    referenceCount: null,
    pausedInterviewCount: null,
    failedInterviewCount: null,
    autosavedInterviewCount: null,
    savedInterviewCount: null,
  });
};
const wirePage = (report = reportFixture()): object => ({
  contractVersion: report.contractVersion,
  versionLimit: report.versionLimit,
  returnedVersionCount: report.returnedVersionCount,
  candidateVersionCount: report.returnedVersionCount,
  listTruncated: report.listTruncated,
  nextOffset: report.nextOffset,
  flows: report.flows.map((flow) => ({
    ...structuredClone(flow),
    versionCount: flow.versions.length,
    limitPercent: Math.floor((flow.versions.length * 100) / report.versionLimit),
  })),
});

describe('flow version list command', () => {
  const sandbox = sinon.createSandbox();
  const args = ['--target-org', 'source', '--flow', 'Invoice_Approval'];
  let report: ConnectFlowVersionListReport;
  let list: sinon.SinonStub;
  let getConnection: sinon.SinonStub;
  let log: sinon.SinonStub;
  let logJson: sinon.SinonStub;
  let warn: sinon.SinonStub;
  let execute: sinon.SinonStub;
  let confirm: sinon.SinonStub;
  let request: sinon.SinonStub;
  let native: boolean;
  let originalExitCode: typeof process.exitCode;
  const expectError = async (commandArgs: string[], fragment?: string): Promise<Error> => {
    let caught: unknown;
    try {
      await FlowVersionList.run(commandArgs);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    if (fragment) expect((caught as Error).message).to.include(fragment);
    return caught as Error;
  };
  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    native = false;
    report = reportFixture();
    const ux = stubSfCommandUx(sandbox);
    log = ux.log;
    logJson = ux.logJson;
    warn = ux.warn;
    request = sandbox.stub();
    getConnection = sandbox
      .stub()
      .returns({ getApiVersion: () => '67.0', getAuthInfoFields: () => ({ orgId: '00D000000000001EAA' }), request });
    sandbox.stub(Org, 'create').resolves({ getConnection, getUsername: () => 'poc@example.com' } as unknown as Org);
    list = sandbox.stub(ConnectFlowVersionListClient.prototype, 'list').resolves(report);
    execute = sandbox.stub(FlowVersionService.prototype, 'execute');
    confirm = sandbox.stub(ConfirmationPrompt.prototype, 'confirm');
  });
  afterEach(() => {
    expect(execute.called).to.equal(false);
    expect(confirm.called).to.equal(false);
    if (!native) expect(request.called).to.equal(false);
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  it('lists an arbitrary Flow and projects only the customer-facing contract', async () => {
    const result = await FlowVersionList.run(args);
    expect(list.calledOnceWithExactly({ flowName: 'Invoice_Approval', all: false })).to.equal(true);
    expect(result).to.have.all.keys('flows');
    expect(result.flows[0]).to.include({
      flow: 'Invoice_Approval',
      versionCount: 3,
      versionLimit: 25,
      deletableCount: null,
    });
    expect(result.flows[0].versions![0]).to.deep.equal({
      versionNumber: 2,
      status: 'Draft',
      versionName: 'Invoice Approval - Review',
      createdDate: '2026-10-01T12:00:00.000Z',
      lastModifiedDate: '2026-10-02T12:00:00.000Z',
      createdByName: 'Flow Author',
      ageDays: 26,
      runInMode: 'DefaultMode',
      apiVersion: '66.0',
      capacityCategory: 'Default',
      areMetricsLoggedToDataCloud: false,
      pausedInterviewCount: 0,
      failedInterviewCount: 0,
      autosavedInterviewCount: 0,
      savedInterviewCount: 0,
      deletable: true,
      outcome: 'PASS',
      reasonCode: null,
      message: null,
      blockingReasons: [],
    });
    expect(getConnection.calledOnceWithExactly(undefined)).to.equal(true);
    expect(String(log.firstCall.args[0])).to.include('Last Modified');
  });
  it('defaults to an org summary without requiring --all and omits version arrays', async () => {
    const result = await FlowVersionList.run(['-o', 'source', '--json']);
    expect(list.firstCall.args[0]).to.deep.equal({ all: true });
    expect(result.flows[0]).not.to.have.property('versions');
    expect(log.called).to.equal(false);
    expect(logJson.firstCall.args[0]).to.deep.include({ status: 0, result });
  });
  it('retains --all as a hidden compatibility option', async () => {
    await FlowVersionList.run(['-o', 'source', '--all']);
    expect(list.firstCall.args[0]).to.deep.equal({ all: true });
    expect(FlowVersionList.flags.all.hidden).to.equal(true);
  });
  it('keeps age and eligibility filters local instead of invoking the created-date backend filter', async () => {
    await FlowVersionList.run([...args, '--older-than', '90d', '--deletable', '--api-version', '67.0']);
    expect(list.firstCall.args[0]).to.deep.equal({ flowName: 'Invoice_Approval', all: false });
    expect(getConnection.calledOnceWithExactly('67.0')).to.equal(true);
  });
  it('retains hidden status and usage compatibility filters', async () => {
    await FlowVersionList.run([...args, '--status', 'Draft', '--min-percent', '80']);
    expect(list.firstCall.args[0]).to.deep.equal({
      flowName: 'Invoice_Approval',
      all: false,
      status: 'Draft',
      minPercent: 80,
    });
    expect(FlowVersionList.flags.status.hidden).to.equal(true);
    expect(FlowVersionList.flags['min-percent'].hidden).to.equal(true);
  });
  it('filters --deletable using the actual PASS verdict rather than counts or status', async () => {
    blocked(report);
    const result = await FlowVersionList.run([...args, '--deletable', '--json']);
    expect(result.flows[0].versions).to.deep.equal([]);
    expect(process.exitCode).to.equal(0);
  });
  it('uses the API saved-interview total without calculating it from category counts', async () => {
    blocked(report);
    const result = await FlowVersionList.run([...args, '--json']);
    expect(result.flows[0].versions![0].blockingReasons[0]).to.include({ code: 'INTERVIEWS', count: 10 });
    expect(result.flows[0].versions![0]).to.include({
      pausedInterviewCount: 2,
      failedInterviewCount: 1,
      autosavedInterviewCount: 7,
      savedInterviewCount: 10,
      reasonCode: 'HAS_INTERVIEWS',
      message: 'This version has saved interviews.',
    });
    expect(result.flows[0].versions![0].deletable).to.equal(false);
    expect(process.exitCode).to.equal(0);
  });
  it('preserves ERROR as unknown eligibility instead of labeling it blocked', async () => {
    errored(report);
    const result = await FlowVersionList.run([...args, '--json']);
    expect(result.flows[0].versions![0]).to.include({
      deletable: false,
      outcome: 'ERROR',
      reasonCode: 'OPERATIONAL',
      message: null,
      error: 'OPERATIONAL',
    });
    expect(result.flows[0].versions![0].blockingReasons).to.deep.equal([]);
    expect(result.flows[0].deletableCount).to.equal(null);
    expect(process.exitCode).to.equal(1);
  });
  it('does not certify a deletable count on a truncated catalog', async () => {
    report.listTruncated = true;
    const result = await FlowVersionList.run([...args, '--json']);
    expect(result.flows[0].deletableCount).to.equal(null);
    expect(process.exitCode).to.equal(68);
  });
  for (const json of [false, true]) {
    it(`reports complete counts after recovering an earlier truncated page in ${
      json ? 'JSON' : 'console'
    } output`, async () => {
      list.restore();
      native = true;
      const flow = { ...report.flows[0], versionCount: 2, limitPercent: 8 };
      const version = report.flows[0].versions[0];
      request.onFirstCall().resolves({
        ...wirePage(),
        candidateVersionCount: 1,
        listTruncated: true,
        nextOffset: 1,
        flows: [{ ...flow, versions: [{ ...version, versionId: '301xx000003Ga19', versionNumber: 1 }] }],
      });
      request.onSecondCall().resolves({
        ...wirePage(),
        candidateVersionCount: 2,
        listTruncated: false,
        nextOffset: null,
        flows: [
          {
            ...flow,
            versions: [
              {
                ...version,
                versionId: '301xx000003Ga20',
                versionNumber: 2,
                status: 'Active',
                outcome: 'BLOCKED',
                deletable: false,
                reasonCode: 'ACTIVE_VERSION',
                message: 'Active versions cannot be deleted.',
              },
            ],
          },
        ],
      });

      const result = await FlowVersionList.run(['-o', 'source', '--all', ...(json ? ['--json'] : [])]);

      expect(request.calledTwice).to.equal(true);
      expect(
        request
          .getCalls()
          .map((call) => (JSON.parse((call.args[0] as { body: string }).body) as { offset: number }).offset)
      ).to.deep.equal([0, 1]);
      expect(result.flows).to.deep.equal([
        { flow: 'Invoice_Approval', versionCount: 2, versionLimit: 25, deletableCount: 1 },
      ]);
      expect(warn.called).to.equal(false);
      expect(process.exitCode).to.equal(0);
      if (json) {
        expect(log.called).to.equal(false);
        expect(logJson.firstCall.args[0]).to.deep.include({ status: 0, result });
        expect((logJson.firstCall.args[0] as { warnings?: unknown[] }).warnings ?? []).to.deep.equal([]);
      } else {
        expect(stripVTControlCharacters(String(log.firstCall.args[0]))).not.to.include('Unavailable');
      }
    });
  }
  it('returns a genuinely empty org summary successfully', async () => {
    report.flows = [];
    report.returnedVersionCount = 0;
    report.catalogComplete = true;
    const result = await FlowVersionList.run(['-o', 'source', '--json']);
    expect(result).to.deep.equal({ flows: [] });
    expect(process.exitCode).to.equal(0);
  });
  it('preserves an actual configured zero limit', async () => {
    report.versionLimit = 0;
    report.flows[0].limitPercent = null;
    const result = await FlowVersionList.run([...args, '--json']);
    expect(result.flows[0].versionLimit).to.equal(0);
  });
  for (const filterArgs of [['--older-than', '90d'], ['--deletable']]) {
    it(`requires --flow for ${filterArgs[0]} before opening a connection`, async () => {
      const error = await expectError(['-o', 'source', ...filterArgs], 'require --flow');
      expect((error as SfError).exitCode).to.equal(2);
      expect(list.called).to.equal(false);
      expect(getConnection.called).to.equal(false);
    });
  }
  for (const age of ['90h', '-1d', '36501d', '9007199254740992d']) {
    it(`rejects malformed age ${age} before opening a connection`, async () => {
      const error = await expectError([...args, '--older-than', age]);
      expect((error as SfError).exitCode).to.equal(2);
      expect(getConnection.called).to.equal(false);
    });
  }
  for (const value of ['-1', '101', '80.5', 'many']) {
    it(`rejects invalid --min-percent ${value}`, async () => {
      const error = await expectError([...args, '--min-percent', value]);
      expect((error as SfError).exitCode ?? (error as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
      expect(getConnection.called).to.equal(false);
    });
  }
  it('rejects simultaneous --flow and --all', async () => {
    await expectError([...args, '--all']);
    expect(list.called).to.equal(false);
    expect(getConnection.called).to.equal(false);
  });
  it('rejects unsupported namespace filtering without an HTTP request', async () => {
    list.restore();
    await expectError([...args, '--namespace', 'billing'], 'namespace');
    expect(request.called).to.equal(false);
  });
  it('reports typed protocol failures without fabricated data', async () => {
    list.rejects(new FlowVersionError('INVALID_LIST_RESPONSE', 'List response rejected.'));
    const error = await expectError(args, 'List response rejected.');
    expect((error as SfError).code).to.equal('INVALID_LIST_RESPONSE');
    expect(log.called).to.equal(false);
  });
  it('rejects an unsupported API version before HTTP', async () => {
    list.restore();
    getConnection.returns({
      getApiVersion: () => '66.0',
      getAuthInfoFields: () => ({ orgId: '00D000000000001EAA' }),
      request,
    });
    const error = await expectError(args, '67.0');
    expect((error as SfError).exitCode).to.equal(2);
    expect(request.called).to.equal(false);
  });
  it('routes standard command words and flags through the real command loader', async () => {
    const result = await runCli(['flow', 'version', 'list', ...args, '--json'], {
      root: fileURLToPath(new URL('../../../../', import.meta.url)),
      devPlugins: false,
      userPlugins: false,
    });
    expect(result).to.have.all.keys('flows');
    expect(list.calledOnce).to.equal(true);
  });
  it('calls only the existing Core list route and never sends the created-date filter', async () => {
    list.restore();
    native = true;
    request.resolves(wirePage());
    await FlowVersionList.run([...args, '--older-than', '0d', '--deletable', '--json']);
    expect(request.calledOnce).to.equal(true);
    const [req, opts] = request.firstCall.args as [{ method: string; url: string; body: string }, unknown];
    expect(req.method).to.equal('POST');
    expect(req.url).to.equal('/connect/interaction/flow-versions/list');
    expect(JSON.parse(req.body)).to.deep.equal({
      contractVersion: '1',
      flowApiName: 'Invoice_Approval',
      offset: 0,
      limit: 100,
    });
    expect(opts).to.deep.include({ followRedirect: false, retry: { methods: [], maxRetries: 0 } });
  });
});

const plainText = (value: string): string => stripVTControlCharacters(value);
const tableText = (value: string): string =>
  plainText(value)
    .replace(/[│┃┏┓┗┛┌┐└┘┬┴┼─━├┤╭╮╯╰]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
const textWithoutLayout = (value: string): string => tableText(value).replace(/\s/gu, '');

describe('formatVersionListReport', () => {
  it('displays Setup version fields and available Core capacity/count values', () => {
    const report = commandReportFixture();
    const output = formatVersionListReport(report, 120);
    const text = tableText(output);
    expect(output.startsWith('\n=== Flow versions\n')).to.equal(true);
    expect(output.endsWith('\n')).to.equal(true);
    expect(text).to.include('Version usage: 3/25 (12%) before filtering');
    for (const field of [
      'Flow Version Name Invoice Approval - Review',
      'Version 2',
      'Status Draft',
      'Age 26d',
      'Created By Flow Author',
      'Created Date 2026-10-01T12:00:00.000Z',
      'Last Modified Date 2026-10-02T12:00:00.000Z',
      'Run in Mode DefaultMode',
      'Flow API Version 66.0',
      'Capacity Category Default',
      'Log Metrics to Data Cloud No',
      'Paused Interviews 0',
      'Failed Interviews 0',
      'Deletable Yes',
      'Reason —',
    ])
      expect(text, field).to.include(field);
    for (const internal of [
      report.flows[0].definitionId,
      report.flows[0].versions[0].versionId,
      'Warning:',
      'assessmentErrors',
    ])
      expect(text).not.to.include(internal);
  });
  it('shows No and the complete opaque backend explanation without extra evidence lookup', () => {
    const report = commandReportFixture();
    const message = 'This version has saved interviews.';
    blocked(report, message);
    const output = formatVersionListReport(report, 100);
    expect(tableText(output)).to.include('Deletable No');
    expect(textWithoutLayout(output)).to.include(message.replace(/\s/gu, ''));
    for (const value of ['Paused Interviews 2', 'Failed Interviews 1']) expect(tableText(output)).to.include(value);
    expect(output).not.to.include('Blocker details');
  });
  it('keeps the list verdict independent of deletion preview and other saved-interview statuses', () => {
    const report = commandReportFixture();
    Object.assign(report.flows[0].versions[0], {
      deletable: false,
      outcome: 'BLOCKED',
      reasonCode: 'HAS_INTERVIEWS',
      message: 'This version has saved interviews.',
      pausedInterviewCount: 0,
      failedInterviewCount: 0,
    });
    const text = tableText(formatVersionListReport(report, 120));
    expect(text).to.include('Paused Interviews 0');
    expect(text).to.include('Failed Interviews 0');
    expect(text).to.include('Deletable No');
    expect(text).to.include('Reason This version has saved interviews.');
    expect(text).not.to.include('Referenced By');
  });
  it('shows a blocked unsupported status using the list reason without converting it to a delete error', () => {
    const report = commandReportFixture();
    Object.assign(report.flows[0].versions[0], {
      status: 'UnderReview',
      deletable: false,
      outcome: 'BLOCKED',
      reasonCode: 'STATUS_NOT_DELETABLE',
      message: 'This version cannot be deleted in its current status.',
    });
    const text = tableText(formatVersionListReport(report, 120));
    expect(text).to.include('Status UnderReview');
    expect(text).to.include('Deletable No');
    expect(text).to.include('Reason This version cannot be deleted in its current status.');
  });
  it('preserves unknown future reason messages', () => {
    const report = commandReportFixture();
    blocked(report, 'NEW_SERVER_POLICY: custom detail');
    report.flows[0].versions[0].reasonCode = 'NEW_SERVER_POLICY';
    expect(tableText(formatVersionListReport(report, 120))).to.include('Reason NEW_SERVER_POLICY: custom detail');
  });
  it('renders only the server verdict without local status/count blocker rules', () => {
    const report = commandReportFixture();
    Object.assign(report.flows[0].versions[0], {
      status: 'Active',
      pausedInterviewCount: 9,
      failedInterviewCount: 3,
    });
    const text = tableText(formatVersionListReport(report, 120));
    expect(text).to.include('Deletable Yes');
    expect(text).to.include('Paused Interviews 9');
  });
  it('shows Error separately from No and leaves real null counts unavailable', () => {
    const report = commandReportFixture();
    errored(report);
    const text = tableText(formatVersionListReport(report, 120));
    expect(text).to.include('Deletable Error');
    expect(text).to.include('Reason OPERATIONAL');
    for (const field of ['Paused Interviews', 'Failed Interviews']) expect(text).to.include(field + ' Unavailable');
    expect(text).not.to.include('Deletable No');
    expect(text).not.to.include('Referenced By');
  });
  it('preserves the server integer utilization percentage rather than recalculating it', () => {
    const report = commandReportFixture();
    report.versionLimit = 30;
    report.flows[0].limitPercent = 10;
    expect(formatVersionListReport(report, 120)).to.include('Version usage: 3/30 (10%)');
  });
  it('displays null metadata as unavailable without synthesizing names, dates or ages', () => {
    const report = commandReportFixture();
    const v = report.flows[0].versions[0];
    Object.assign(v, {
      versionName: null,
      createdByName: null,
      createdDate: null,
      lastModifiedDate: null,
      ageDays: null,
      status: null,
      runInMode: null,
      apiVersion: null,
      capacityCategory: null,
      areMetricsLoggedToDataCloud: null,
    });
    report.flows[0].versionCount = null;
    report.flows[0].limitPercent = null;
    const text = tableText(formatVersionListReport(report, 120));
    for (const field of [
      'Status Unavailable',
      'Age Unavailable',
      'Created Date Unavailable',
      'Last Modified Date Unavailable',
      'Created By Name unavailable',
      'Flow Version Name Name unavailable',
      'Run in Mode Unavailable',
      'Flow API Version Unavailable',
      'Capacity Category Unavailable',
      'Log Metrics to Data Cloud Unavailable',
    ])
      expect(text).to.include(field);
    expect(text).to.include('count unavailable/25 (percentage unavailable)');
  });
  it('distinguishes true, false and unavailable Data Cloud metrics values', () => {
    const report = commandReportFixture();
    const version = report.flows[0].versions[0];
    version.areMetricsLoggedToDataCloud = true;
    expect(tableText(formatVersionListReport(report, 120))).to.include('Log Metrics to Data Cloud Yes');
    version.areMetricsLoggedToDataCloud = false;
    expect(tableText(formatVersionListReport(report, 120))).to.include('Log Metrics to Data Cloud No');
    delete version.areMetricsLoggedToDataCloud;
    expect(tableText(formatVersionListReport(report, 120))).to.include('Log Metrics to Data Cloud Unavailable');
    expect(version).not.to.have.property('areMetricsLoggedToDataCloud');
  });
  it('keeps zero limit and undefined percentage explicit', () => {
    const report = commandReportFixture();
    report.versionLimit = 0;
    report.flows[0].limitPercent = null;
    const text = formatVersionListReport(report, 120);
    expect(text).to.include('3/0 (percentage unavailable)');
    expect(text).not.to.include('Infinity');
    expect(text).not.to.include('VERSION_LIMIT_UNAVAILABLE');
  });
  it('reports a genuinely empty selection and separately identifies server truncation', () => {
    const report = commandReportFixture();
    report.flows = [];
    report.returnedVersionCount = 0;
    expect(formatVersionListReport(report)).to.include('No Flow versions match');
    report.listTruncated = true;
    const output = formatVersionListReport(report);
    expect(output).to.include('incomplete list');
    expect(output).not.to.include('No Flow versions match');
  });
  it('does not warn when continuation recovered the complete catalog', () => {
    const report = commandReportFixture();
    Object.assign(report, { listTruncated: true, catalogComplete: true, candidateVersionCount: 1 });
    Object.assign(report.flows[0], { versionCount: 1, limitPercent: 4 });
    const output = formatVersionListReport(report);
    expect(output).not.to.include('Warning:');
    expect(output).not.to.include('incomplete list');
    expect(output).to.include('Invoice_Approval');
  });
  it('sanitizes backend and org control characters while preserving JSON values separately', () => {
    const report = commandReportFixture();
    blocked(report, '\u001b]8;;https://example.com\u0007link\nforged\u202e');
    report.targetOrg = '\u001b[31munsafe\u001b[0m\norg\u202e';
    report.flows[0].apiName = 'Invoice\nFORGED';
    Object.assign(report.flows[0].versions[0], {
      versionName: 'Review\nFORGED\u202e',
      createdByName: 'Author\nFORGED\u001b[31m',
    });
    const output = plainText(formatVersionListReport(report, 120));
    for (const control of ['\u0007', '\u202e', '\r', '\t']) expect(output).not.to.include(control);
    expect(output).to.include('Target org: unsafe org');
    expect(output).not.to.include('\nFORGED');
    expect(report.flows[0].versions[0].versionName).to.include('\nFORGED');
  });
});

describe('standard Flow version table', () => {
  const row = (): FlowVersionTableRow => ({
    versionName: 'Invoice Approval - Review',
    version: '2',
    status: 'Draft',
    age: '26d',
    creator: 'Flow Author',
    createdDate: '2026-10-01T12:00:00.000Z',
    lastModifiedDate: '2026-10-02T12:00:00.000Z',
    runInMode: 'DefaultMode',
    apiVersion: '66.0',
    capacityCategory: 'Default',
    metricsLoggedToDataCloud: 'No',
    paused: '1',
    failed: '1',
    deletable: 'No',
    reason: 'HAS_INTERVIEWS; FUTURE_SERVER_POLICY (a complete explanation that must never be truncated)',
  });

  it('uses every supported column in wide consoles and keeps every complete value', () => {
    const value = row();
    const text = formatFlowVersionTable([value], 360);
    const dataLines = plainText(text)
      .split('\n')
      .filter((line) => line.startsWith('│'))
      .slice(1)
      .map((line) => line.split('│').slice(1, -1));
    for (const [index, field] of Object.values(value).entries()) {
      const cell = dataLines
        .map((line) => line[index] ?? '')
        .join('')
        .replace(/\s/gu, '');
      expect(cell, field).to.equal(field.replace(/\s/gu, ''));
    }
    expect(text).to.include('Last Modified Date');
    expect(text).not.to.include('Field');
  });

  it('uses a readable Field/Value table in normal consoles and wraps rather than truncating reasons', () => {
    const value = row();
    const text = formatFlowVersionTable([value], 80);
    expect(text).to.include('Field');
    expect(text).to.include('Value');
    for (const field of Object.values(value))
      expect(textWithoutLayout(text), field).to.include(field.replace(/\s/gu, ''));
    for (const line of plainText(text).split('\n')) expect(Array.from(line).length).to.be.at.most(80);
  });

  it('returns no table for an empty list', () => {
    expect(formatFlowVersionTable([], 80)).to.equal('');
  });
});

describe('Flow version list customer JSON contract', () => {
  const generatedSchema = JSON.parse(
    readFileSync(new URL('../../../../schemas/flow-version-list.json', import.meta.url), 'utf8')
  ) as object;
  const validateGenerated = new Ajv({ allErrors: true }).compile(generatedSchema);
  const schema = JSON.parse(
    readFileSync(new URL('../../../contracts/flow-version-list.json', import.meta.url), 'utf8')
  ) as object;
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const projected = (report = reportFixture()): FlowVersionListCommandResult =>
    projectVersionList(report, { flowName: 'Invoice_Approval' });
  const expectValid = (report: FlowVersionListCommandResult): void => {
    expect(validateGenerated(report), JSON.stringify(validateGenerated.errors)).to.equal(true);
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
  };
  it('validates projected single-Flow details and org summaries', () => {
    for (const result of [projected(), projectVersionList(reportFixture())]) expectValid(result);
  });
  it('validates blocked and failed assessment rows without fabricating counts', () => {
    const report = reportFixture();
    blocked(report);
    expectValid(projected(report));
    errored(report);
    expectValid(projected(report));
  });
  it('rejects structurally malformed output using the generated schema', () => {
    const report = projected();
    Object.assign(report.flows[0], { versionLimit: 'not-a-number' });
    expect(validateGenerated(report)).to.equal(false);
  });
  it('rejects contradictory eligibility shapes', () => {
    const report = projected();
    report.flows[0].versions![0].deletable = false;
    expect(validate(report)).to.equal(false);
    Object.assign(report.flows[0].versions![0], { deletable: null });
    expect(validate(report)).to.equal(false);
  });
  it('does not expose internal SDK result fields', () => {
    for (const field of ['scope', 'filters', 'candidateVersionCount', 'orgId', 'contractVersion']) {
      const report = projected();
      Object.assign(report, { [field]: 'unexpected' });
      expect(validate(report), field).to.equal(false);
    }
    const report = projected();
    Object.assign(report.flows[0].versions![0], { referenceCount: 0 });
    expect(validate(report)).to.equal(false);
  });
});
