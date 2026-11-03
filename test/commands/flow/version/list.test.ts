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
          referenceCount: 0,
          pausedInterviewCount: 0,
          failedInterviewCount: 0,
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
const blocked = (
  report: ConnectFlowVersionListReport,
  message = 'PAUSED_INTERVIEWS (2); REFERENCED_BY_VERSION (ParentFlow)'
): void => {
  Object.assign(report.flows[0].versions[0], {
    outcome: 'BLOCKED',
    deletable: false,
    reasonCode: 'PAUSED_INTERVIEWS',
    message,
    referenceCount: 2,
    pausedInterviewCount: 2,
    failedInterviewCount: 1,
  });
};
const errored = (report: ConnectFlowVersionListReport): void => {
  Object.assign(report.flows[0].versions[0], {
    outcome: 'ERROR',
    deletable: false,
    reasonCode: 'OWNED_RESOURCE_CHECK_INCOMPLETE',
    message: null,
    referenceCount: null,
    pausedInterviewCount: null,
    failedInterviewCount: null,
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
  let logToStderr: sinon.SinonStub;
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
    logToStderr = ux.logToStderr;
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

  it('lists an arbitrary Flow using only the authenticated Connect list client', async () => {
    const result = await FlowVersionList.run(args);
    expect(list.calledOnceWithExactly({ flowName: 'Invoice_Approval', all: false, deletable: false })).to.equal(true);
    expect(result).to.deep.equal(commandReportFixture(report));
    expect(getConnection.calledOnceWithExactly(undefined)).to.equal(true);
    expect(log.calledOnce).to.equal(true);
    expect(String(log.firstCall.args[0])).to.include('Deletable');
  });
  it('forwards API version, native status, age and usage filters', async () => {
    await FlowVersionList.run([
      '-o',
      'source',
      '-f',
      'billing__Receipt_Reconciliation',
      '--api-version',
      '67.0',
      '--status',
      'Draft',
      '--older-than',
      '90d',
      '--min-percent',
      '80',
    ]);
    expect(
      list.calledOnceWithExactly({
        flowName: 'billing__Receipt_Reconciliation',
        all: false,
        deletable: false,
        status: 'Draft',
        olderThan: '90d',
        minPercent: 80,
      })
    ).to.equal(true);
    expect(getConnection.calledOnceWithExactly('67.0')).to.equal(true);
  });
  it('forwards --deletable to the server-backed SDK without local eligibility rules', async () => {
    await FlowVersionList.run([...args, '--deletable']);
    expect(list.firstCall.args[0]).to.deep.equal({ flowName: 'Invoice_Approval', all: false, deletable: true });
  });
  it('supports an all-org scope without injecting namespace restrictions', async () => {
    await FlowVersionList.run(['-o', 'source', '--all']);
    expect(list.firstCall.args[0]).to.deep.equal({ all: true, deletable: false });
  });
  it('returns native grouped contract 1 and authoritative counts without duplicate legacy arrays', async () => {
    const result = await FlowVersionList.run([...args, '--json']);
    expect(result).to.deep.equal(commandReportFixture(report));
    expect(result.contractVersion).to.equal('1');
    expect(result.flows[0].versions[0].referenceCount).to.equal(0);
    for (const field of ['rows', 'assessmentErrors', 'countErrors', 'capacityErrors'])
      expect(result).not.to.have.property(field);
    expect(log.called).to.equal(false);
    expect(logToStderr.called).to.equal(false);
    expect(logJson.firstCall.args[0]).to.deep.include({ status: 0, result });
  });
  it('retains mixed PASS and ERROR rows in JSON and exits 1 after returning the report', async () => {
    const success = structuredClone(report.flows[0].versions[0]);
    errored(report);
    report.flows[0].versions.push({ ...success, versionNumber: 3, versionId: '301000000000003AAA' });
    report.returnedVersionCount = 2;
    const result = await FlowVersionList.run([...args, '--json']);
    expect(result.flows[0].versions).to.have.length(2);
    expect(process.exitCode).to.equal(1);
    expect(logJson.firstCall.args[0]).to.deep.include({ status: 1, result });
  });
  it('does not treat BLOCKED alone as an operational failure', async () => {
    blocked(report);
    await FlowVersionList.run([...args, '--json']);
    expect(process.exitCode).to.equal(undefined);
    expect(logJson.firstCall.args[0]).to.include({ status: 0 });
  });
  it('marks a server-truncated result incomplete in console and JSON exit status', async () => {
    report.listTruncated = true;
    const result = await FlowVersionList.run(args);
    expect(result.listTruncated).to.equal(true);
    expect(process.exitCode).to.equal(1);
    expect(String(log.firstCall.args[0])).to.include('not a complete inventory');
  });
  it('keeps an actual zero limit and null percentage without inventing capacity errors', async () => {
    report.versionLimit = 0;
    report.flows[0].limitPercent = null;
    const result = await FlowVersionList.run([...args, '--json']);
    expect(result.versionLimit).to.equal(0);
    expect(result.flows[0].limitPercent).to.equal(null);
    expect(process.exitCode).to.equal(undefined);
  });
  it('maps typed SDK validation and protocol failures to SfError', async () => {
    list.rejects(new FlowVersionError('INVALID_LIST_RESPONSE', 'List response rejected.'));
    const error = await expectError(args, 'List response rejected.');
    expect(error).to.be.instanceOf(SfError);
    expect((error as SfError).code).to.equal('INVALID_LIST_RESPONSE');
    expect(log.called).to.equal(false);
  });
  it('preserves a normal SDK whole-request failure', async () => {
    list.rejects(new SfError('List request failed.', 'LIST_REQUEST_FAILED'));
    expect((await expectError(args, 'List request failed.')).name).to.equal('LIST_REQUEST_FAILED');
  });
  it('routes normal spaced command words and standard flags through the real CLI', async () => {
    const result = await runCli(['flow', 'version', 'list', ...args, '--json'], {
      root: fileURLToPath(new URL('../../../../', import.meta.url)),
      devPlugins: false,
      userPlugins: false,
    });
    expect(result).to.deep.equal(commandReportFixture(report));
    expect(list.calledOnce).to.equal(true);
  });
  it('requires exactly one scope before opening a connection', async () => {
    await expectError(['-o', 'source'], 'Choose exactly one scope');
    expect(list.called).to.equal(false);
    expect(getConnection.called).to.equal(false);
  });
  it('rejects simultaneous --flow and --all', async () => {
    await expectError([...args, '--all']);
    expect(list.called).to.equal(false);
    expect(getConnection.called).to.equal(false);
  });
  for (const value of ['-1', '101', '80.5', 'many']) {
    it(`rejects invalid --min-percent ${value}`, async () => {
      await expectError([...args, '--min-percent', value]);
      expect(list.called).to.equal(false);
      expect(getConnection.called).to.equal(false);
    });
  }
  for (const value of ['0', '100']) {
    it(`accepts the --min-percent boundary ${value}`, async () => {
      await FlowVersionList.run([...args, '--min-percent', value]);
      expect(list.firstCall.args[0]).to.include({ minPercent: Number(value) });
    });
  }
  it('rejects mutation flags', async () => {
    await expectError([...args, '--force'], '--force');
    expect(list.called).to.equal(false);
  });
  it('provides help without authenticating', async () => {
    await runCli(['flow', 'version', 'list', '--help'], {
      root: fileURLToPath(new URL('../../../../', import.meta.url)),
      devPlugins: false,
      userPlugins: false,
    });
    expect(list.called).to.equal(false);
    expect(getConnection.called).to.equal(false);
  });
  it('calls only the Core list endpoint through the native connection interface', async () => {
    list.restore();
    native = true;
    request.resolves(wirePage());
    const result = await FlowVersionList.run([...args, '--api-version', '67.0', '--json']);
    expect(result.flows[0].versions[0].referenceCount).to.equal(0);
    expect(request.calledOnce).to.equal(true);
    const [req, opts] = request.firstCall.args as [{ method: string; url: string; body: string }, unknown];
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(req.method).to.equal('POST');
    expect(req.url).to.equal('/connect/interaction/flow-versions/list');
    expect(body).to.include({
      contractVersion: '1',
      flowApiName: 'Invoice_Approval',
      offset: 0,
      limit: 100,
    });
    expect(body).not.to.have.property('deletable');
    expect(opts).to.deep.include({ followRedirect: false, retry: { methods: [], maxRetries: 0 } });
  });
  it('continues an empty page using the server nextOffset instead of row count', async () => {
    list.restore();
    native = true;
    const filtered = reportFixture();
    filtered.candidateVersionCount = 600;
    filtered.versionLimit = 1000;
    filtered.flows[0].versionCount = 600;
    filtered.flows[0].limitPercent = 60;
    const page = {
      ...wirePage(filtered),
      candidateVersionCount: 600,
      flows: structuredClone(filtered.flows),
    };
    request.onFirstCall().resolves({ ...page, returnedVersionCount: 0, flows: [], nextOffset: 500 });
    request.onSecondCall().resolves(page);
    const result = await FlowVersionList.run([...args, '--deletable', '--json']);
    expect(request.callCount).to.equal(2);
    const body = JSON.parse((request.secondCall.args[0] as { body: string }).body) as Record<string, unknown>;
    expect(body.offset).to.equal(500);
    expect(body.deletable).to.equal(true);
    expect(result.returnedVersionCount).to.equal(1);
    expect(result.candidateVersionCount).to.equal(600);
  });
  it('rejects unsupported namespace filtering before any API request', async () => {
    list.restore();
    native = true;
    await expectError([...args, '--namespace', 'billing'], 'namespace');
    expect(request.called).to.equal(false);
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
  it('displays every required A3/C1 field and actual Core capacity/count values', () => {
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
      'Referenced By 0',
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
    const message = 'PAUSED_INTERVIEWS (2); REFERENCED_BY_VERSION (ParentFlow, OtherFlow)';
    blocked(report, message);
    const output = formatVersionListReport(report, 100);
    expect(tableText(output)).to.include('Deletable No');
    expect(textWithoutLayout(output)).to.include(message.replace(/\s/gu, ''));
    for (const value of ['Referenced By 2', 'Paused Interviews 2', 'Failed Interviews 1'])
      expect(tableText(output)).to.include(value);
    expect(output).not.to.include('Blocker details');
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
      referenceCount: 4,
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
    expect(text).to.include('Reason OWNED_RESOURCE_CHECK_INCOMPLETE');
    for (const field of ['Referenced By', 'Paused Interviews', 'Failed Interviews'])
      expect(text).to.include(field + ' Unavailable');
    expect(text).not.to.include('Deletable No');
    expect(text).not.to.include('Referenced By 0');
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
    ])
      expect(text).to.include(field);
    expect(text).to.include('count unavailable/25 (percentage unavailable)');
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
    references: '2',
    paused: '1',
    failed: '1',
    deletable: 'No',
    reason: 'PAUSED_INTERVIEWS (1); FUTURE_SERVER_POLICY (a complete explanation that must never be truncated)',
  });

  it('uses all A3/C1 columns in wide consoles and keeps every complete value', () => {
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

describe('Flow version list JSON contract', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../../../schemas/flow-version-list.json', import.meta.url), 'utf8')
  ) as object;
  const validate = new Ajv({ allErrors: true }).compile(schema);
  it('validates native grouped rows with authoritative counts and configured limit', () => {
    const report = commandReportFixture();
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
    expect(report.contractVersion).to.equal('1');
    expect(report.flows[0].versions[0]).not.to.have.property('assessment');
  });
  it('validates BLOCKED and ERROR without duplicated error collections', () => {
    const report = commandReportFixture();
    blocked(report);
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
    errored(report);
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
  });
  it('permits real null metadata and incomplete totals without guessing them', () => {
    const report = commandReportFixture();
    errored(report);
    report.flows[0].versionCount = null;
    report.flows[0].limitPercent = null;
    Object.assign(report.flows[0].versions[0], {
      createdDate: null,
      createdById: null,
      lastModifiedDate: null,
      ageDays: null,
    });
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
  });
  it('accepts a zero configured limit only with null percentage', () => {
    const report = commandReportFixture();
    report.versionLimit = 0;
    expect(validate(report)).to.equal(false);
    report.flows[0].limitPercent = null;
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
  });
  it('rejects contradictory eligibility outcomes', () => {
    const report = commandReportFixture();
    report.flows[0].versions[0].deletable = false;
    expect(validate(report)).to.equal(false);
    blocked(report);
    report.flows[0].versions[0].deletable = true;
    expect(validate(report)).to.equal(false);
    errored(report);
    report.flows[0].versions[0].deletable = true;
    expect(validate(report)).to.equal(false);
  });
  it('rejects missing, negative or null success counts', () => {
    const report = commandReportFixture();
    report.flows[0].versions[0].referenceCount = -1;
    expect(validate(report)).to.equal(false);
    report.flows[0].versions[0].referenceCount = null;
    expect(validate(report)).to.equal(false);
    delete (report.flows[0].versions[0] as unknown as Record<string, unknown>).failedInterviewCount;
    expect(validate(report)).to.equal(false);
  });
  it('rejects obsolete format6 arrays and synthesized assessment/evidence fields', () => {
    for (const field of ['rows', 'assessmentErrors', 'countErrors', 'capacityErrors']) {
      const report = commandReportFixture();
      Object.assign(report, { [field]: [] });
      expect(validate(report), field).to.equal(false);
    }
    for (const field of ['assessment', 'evidence', 'c1Counts', 'countError', 'capacityError']) {
      const report = commandReportFixture();
      Object.assign(report.flows[0].versions[0], { [field]: [] });
      expect(validate(report), field).to.equal(false);
    }
    const report = commandReportFixture();
    Object.assign(report, { contractVersion: '6' });
    expect(validate(report)).to.equal(false);
  });
  it('validates a preserved server truncation flag without asserting a complete org total', () => {
    const report = commandReportFixture();
    report.listTruncated = true;
    report.candidateVersionCount = 2000;
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
    expect(report).not.to.have.property('totalVersions');
  });
});
