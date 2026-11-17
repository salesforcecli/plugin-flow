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
import { expect } from 'chai';
import type { ConnectFlowVersionListReport, ConnectFlowVersionListVersion } from '@salesforce/flow-node';
import { projectVersionList, formatVersionListResult } from '../../src/reporters/flowVersionListReport.js';

const version = (number: number): ConnectFlowVersionListVersion => ({
  versionId: `30100000000000${number}AAA`,
  versionNumber: number,
  versionName: `Version ${number}`,
  status: 'Draft',
  createdDate: '2025-01-01T00:00:00.000Z',
  ageDays: 400,
  createdById: '005000000000001AAA',
  createdByName: 'Flow Author',
  lastModifiedDate: '2026-10-01T00:00:00.000Z',
  referenceCount: null,
  pausedInterviewCount: 0,
  failedInterviewCount: 0,
  autosavedInterviewCount: 0,
  savedInterviewCount: 0,
  runInMode: 'DefaultMode',
  apiVersion: '69.0',
  capacityCategory: 'HighScale',
  areMetricsLoggedToDataCloud: false,
  deletable: true,
  outcome: 'PASS',
  reasonCode: null,
  message: null,
});
const fixture = (): ConnectFlowVersionListReport => ({
  contractVersion: '1',
  orgId: '00D000000000001EAA',
  generatedAt: '2026-11-12T12:00:00.000Z',
  scope: { all: false, flowName: 'Invoice', namespace: null, allNamespaces: false },
  filters: { status: null, olderThan: null, minPercent: null, deletable: false },
  versionLimit: 50,
  returnedVersionCount: 3,
  candidateVersionCount: 3,
  listTruncated: false,
  catalogComplete: true,
  nextOffset: null,
  flows: [
    {
      definitionId: '300000000000001AAA',
      apiName: 'Invoice',
      label: 'Invoice',
      versionCount: 3,
      limitPercent: 6,
      versions: [version(1), version(3), version(2)],
    },
  ],
});

describe('approved C1 customer projection', () => {
  it('returns a sorted org summary without internal fields or version arrays', () => {
    const raw = fixture();
    raw.flows.push({
      ...raw.flows[0],
      apiName: 'More_Versions',
      definitionId: '300000000000002AAA',
      versionCount: 4,
      versions: [version(1), version(2), version(3), version(4)],
    });
    const output = projectVersionList(raw);
    expect(output).to.deep.equal({
      flows: [
        { flow: 'More_Versions', versionCount: 4, versionLimit: 50, deletableCount: 4 },
        { flow: 'Invoice', versionCount: 3, versionLimit: 50, deletableCount: 3 },
      ],
    });
  });
  it('sorts detailed versions newest first without mutating SDK facts', () => {
    const raw = fixture();
    const original = structuredClone(raw);
    const output = projectVersionList(raw, { flowName: 'Invoice' });
    expect(output.flows[0].versions!.map((row) => row.versionNumber)).to.deep.equal([3, 2, 1]);
    expect(raw).to.deep.equal(original);
    expect(output.flows[0].versions![0]).to.have.all.keys(
      'versionNumber',
      'status',
      'versionName',
      'createdDate',
      'lastModifiedDate',
      'createdByName',
      'ageDays',
      'runInMode',
      'apiVersion',
      'capacityCategory',
      'areMetricsLoggedToDataCloud',
      'pausedInterviewCount',
      'failedInterviewCount',
      'autosavedInterviewCount',
      'savedInterviewCount',
      'outcome',
      'reasonCode',
      'message',
      'deletable',
      'blockingReasons'
    );
  });
  it('uses Last Modified Date and keeps the exact age cutoff excluded', () => {
    const raw = fixture();
    raw.flows[0].versions[0].lastModifiedDate = '2026-08-13T23:59:59.999Z';
    raw.flows[0].versions[1].lastModifiedDate = '2026-08-14T00:00:00.000Z';
    raw.flows[0].versions[2].lastModifiedDate = '2026-11-01T00:00:00.000Z';
    const output = projectVersionList(raw, {
      flowName: 'Invoice',
      olderThanDays: 90,
      now: Date.parse('2026-11-12T00:00:00.000Z'),
    });
    expect(output.flows[0].versions!.map((row) => row.versionNumber)).to.deep.equal([1]);
    expect(output.flows[0].versionCount).to.equal(3);
    expect(output.flows[0].deletableCount).to.equal(3);
  });
  it('does not classify missing Last Modified Date as old', () => {
    const raw = fixture();
    raw.flows[0].versions[0].lastModifiedDate = null;
    const output = projectVersionList(raw, {
      flowName: 'Invoice',
      olderThanDays: 0,
      now: Date.parse('2026-11-12T00:00:00.000Z'),
    });
    expect(output.flows[0].versions!.map((row) => row.versionNumber)).to.deep.equal([3, 2]);
  });
  it('returns only actual PASS rows for --deletable and preserves unfiltered totals', () => {
    const raw = fixture();
    Object.assign(raw.flows[0].versions[0], {
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'ACTIVE_VERSION',
      message: 'Active.',
    });
    const output = projectVersionList(raw, { flowName: 'Invoice', deletable: true });
    expect(output.flows[0].versions!.map((row) => row.versionNumber)).to.deep.equal([3, 2]);
    expect(output.flows[0].deletableCount).to.equal(2);
    expect(output.flows[0].versionCount).to.equal(3);
  });
  it('preserves the authoritative saved total instead of summing the categories', () => {
    const raw = fixture();
    Object.assign(raw.flows[0].versions[0], {
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'HAS_INTERVIEWS',
      message: 'Saved interviews.',
      pausedInterviewCount: 2,
      failedInterviewCount: 3,
      autosavedInterviewCount: 4,
      savedInterviewCount: 17,
    });
    const output = projectVersionList(raw, { flowName: 'Invoice' });
    expect(output.flows[0].versions!.at(-1)!.blockingReasons).to.deep.equal([
      { code: 'INTERVIEWS', message: 'Saved interviews.', count: 17 },
    ]);
  });
  it('counts a recovered catalog after an earlier truncated page without counting blocked rows', () => {
    const raw = fixture();
    raw.listTruncated = true;
    Object.assign(raw.flows[0].versions[0], {
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'ACTIVE_VERSION',
      message: 'Active.',
    });
    expect(projectVersionList(raw).flows[0].deletableCount).to.equal(2);
  });
  it('leaves totals unavailable for incomplete catalogs or assessment errors', () => {
    const raw = fixture();
    raw.listTruncated = true;
    raw.catalogComplete = false;
    expect(projectVersionList(raw).flows[0].deletableCount).to.equal(null);
    raw.listTruncated = false;
    raw.catalogComplete = false;
    expect(projectVersionList(raw).flows[0].deletableCount).to.equal(null);
    raw.catalogComplete = true;
    Object.assign(raw.flows[0].versions[0], {
      outcome: 'ERROR',
      deletable: false,
      reasonCode: 'OPERATIONAL',
      message: null,
    });
    const output = projectVersionList(raw, { flowName: 'Invoice' });
    expect(output.flows[0].deletableCount).to.equal(null);
    expect(output.flows[0].versions!.at(-1)).to.include({
      deletable: false,
      outcome: 'ERROR',
      reasonCode: 'OPERATIONAL',
      message: null,
      error: 'OPERATIONAL',
    });
    expect(output.flows[0].versions!.at(-1)!.blockingReasons).to.deep.equal([]);
  });
  it('preserves actual statuses and future legitimate backend reason codes', () => {
    const raw = fixture();
    Object.assign(raw.flows[0].versions[0], {
      status: 'UnderReview',
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'STATUS_NOT_DELETABLE',
      message: 'Under review.',
    });
    const output = projectVersionList(raw, { flowName: 'Invoice' });
    expect(output.flows[0].versions!.at(-1)).to.include({ status: 'UnderReview', deletable: false });
    expect(output.flows[0].versions!.at(-1)!.blockingReasons[0].code).to.equal('STATUS_NOT_DELETABLE');
  });
  it('keeps the org summary and header while rendering every requested one-Flow column', () => {
    const raw = fixture();
    const summary = formatVersionListResult(projectVersionList(raw), 'prod');
    expect(summary).to.include('Flows in prod by version count');
    expect(summary).not.to.include('Flow Version Name');
    const detail = formatVersionListResult(projectVersionList(raw, { flowName: 'Invoice' }), 'prod', 'Invoice');
    for (const value of [
      'Version',
      'Status',
      'Flow Version Name',
      'Created',
      'Last Modified',
      'Created By',
      'Age',
      'Run in Mode',
      'API Version',
      'Capacity Category',
      'Log Metrics to Data Cloud',
      'Paused',
      'Failed',
      'Autosaved',
      'Saved Interviews',
      'Deletable',
      'Reason',
    ])
      expect(detail).to.include(value);
    expect(detail).to.include('Invoice in prod has 3 of 50 versions.');
    expect(detail).not.to.include('Referenced By');
  });
  it('includes raw API metadata, zero and false values in JSON without old aliases', () => {
    const raw = fixture();
    raw.flows[0].versions[0].ageDays = 0;
    const output = projectVersionList(raw, { flowName: 'Invoice' }).flows[0].versions!.at(-1)!;
    expect(output).to.include({
      versionName: 'Version 1',
      createdByName: 'Flow Author',
      ageDays: 0,
      runInMode: 'DefaultMode',
      apiVersion: '69.0',
      capacityCategory: 'HighScale',
      areMetricsLoggedToDataCloud: false,
      pausedInterviewCount: 0,
      failedInterviewCount: 0,
      autosavedInterviewCount: 0,
      savedInterviewCount: 0,
      reasonCode: null,
      message: null,
    });
    for (const key of ['referenceCount', 'flowVersionName', 'createdBy']) expect(output).not.to.have.property(key);
  });
  it('preserves null and omitted optional fields without inventing zero values', () => {
    const raw = fixture();
    Object.assign(raw.flows[0].versions[0], {
      status: null,
      createdDate: null,
      lastModifiedDate: null,
      createdByName: null,
      ageDays: null,
      versionName: null,
      runInMode: null,
      apiVersion: null,
      capacityCategory: null,
      areMetricsLoggedToDataCloud: null,
      pausedInterviewCount: null,
      failedInterviewCount: null,
      autosavedInterviewCount: null,
      savedInterviewCount: null,
      outcome: 'ERROR',
      deletable: false,
      reasonCode: 'OPERATIONAL',
      message: null,
    });
    const row = projectVersionList(raw, { flowName: 'Invoice' }).flows[0].versions!.at(-1)!;
    expect(row).to.include({
      status: null,
      createdDate: null,
      lastModifiedDate: null,
      createdByName: null,
      versionName: null,
      ageDays: null,
      runInMode: null,
      apiVersion: null,
      capacityCategory: null,
      areMetricsLoggedToDataCloud: null,
      pausedInterviewCount: null,
      failedInterviewCount: null,
      autosavedInterviewCount: null,
      savedInterviewCount: null,
      reasonCode: 'OPERATIONAL',
      message: null,
      outcome: 'ERROR',
      deletable: false,
    });
    delete raw.flows[0].versions[0].autosavedInterviewCount;
    delete raw.flows[0].versions[0].savedInterviewCount;
    delete raw.flows[0].versions[0].runInMode;
    expect(projectVersionList(raw, { flowName: 'Invoice' }).flows[0].versions!.at(-1)).to.include({
      autosavedInterviewCount: null,
      savedInterviewCount: null,
      runInMode: null,
    });
  });
  it('prints INTERVIEWS (0) for a real blocker outside the saved categories', () => {
    const raw = fixture();
    Object.assign(raw.flows[0].versions[0], {
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'HAS_INTERVIEWS',
      message: 'A running interview blocks deletion.',
      savedInterviewCount: 0,
    });
    const report = projectVersionList(raw, { flowName: 'Invoice' });
    expect(report.flows[0].versions!.at(-1)).to.include({ reasonCode: 'HAS_INTERVIEWS', savedInterviewCount: 0 });
    const text = stripVTControlCharacters(formatVersionListResult(report, 'prod', 'Invoice'));
    expect(text).to.include('INTERVIEWS (0)');
    expect(text).not.to.include('count unavailable');
  });
  it('leaves non-interview API reason codes unchanged in JSON and the Reason column', () => {
    const raw = fixture();
    Object.assign(raw.flows[0].versions[0], {
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'LATEST_PACKAGED_VERSION',
      message: 'Keep the raw server explanation.',
    });
    const report = projectVersionList(raw, { flowName: 'Invoice' });
    expect(report.flows[0].versions!.at(-1)).to.include({
      reasonCode: 'LATEST_PACKAGED_VERSION',
      message: 'Keep the raw server explanation.',
    });
    expect(stripVTControlCharacters(formatVersionListResult(report, 'prod', 'Invoice'))).to.include(
      'LATEST_PACKAGED_VERSION'
    );
  });
  it('leaves ERROR count cells blank while keeping known zero counts visible', () => {
    const raw = fixture();
    Object.assign(raw.flows[0].versions[0], {
      versionName: 'Error_Row',
      outcome: 'ERROR',
      deletable: false,
      reasonCode: 'OPERATIONAL',
      message: null,
      pausedInterviewCount: null,
      failedInterviewCount: null,
      autosavedInterviewCount: null,
      savedInterviewCount: null,
    });
    const prior = process.env.OCLIF_TABLE_COLUMN_OVERRIDE;
    process.env.OCLIF_TABLE_COLUMN_OVERRIDE = '800';
    try {
      const text = stripVTControlCharacters(
        formatVersionListResult(projectVersionList(raw, { flowName: 'Invoice' }), 'prod', 'Invoice')
      );
      const lines = text.split('\n').filter((line) => line.includes('Error_Row'));
      expect(lines).to.have.length(1);
      const cells = lines[0]
        .split('│')
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).to.have.length(17);
      expect(cells.slice(11, 15)).to.deep.equal(['', '', '', '']);
      expect(cells[16]).to.equal('OPERATIONAL');
      const known = text.split('\n').find((line) => line.includes('Version 3'))!;
      expect(
        known
          .split('│')
          .slice(1, -1)
          .map((cell) => cell.trim())
          .slice(11, 15)
      ).to.deep.equal(['0', '0', '0', '0']);
    } finally {
      if (prior === undefined) delete process.env.OCLIF_TABLE_COLUMN_OVERRIDE;
      else process.env.OCLIF_TABLE_COLUMN_OVERRIDE = prior;
    }
  });
  it('retains every full cell value when a narrow terminal requires a horizontally wide table', () => {
    const raw = fixture();
    const value = raw.flows[0].versions[0];
    Object.assign(value, {
      versionName: 'Long_Version_Name_'.repeat(8),
      runInMode: 'SystemModeWithSharing_'.repeat(5),
      capacityCategory: 'Large_Capacity_'.repeat(6),
      outcome: 'BLOCKED',
      deletable: false,
      reasonCode: 'FUTURE_POLICY_'.repeat(8),
      message: 'The reason code is authoritative.',
    });
    raw.flows[0].versions = [value];
    const prior = process.env.OCLIF_TABLE_COLUMN_OVERRIDE;
    process.env.OCLIF_TABLE_COLUMN_OVERRIDE = '60';
    try {
      const output = stripVTControlCharacters(
        formatVersionListResult(projectVersionList(raw, { flowName: 'Invoice' }), 'prod', 'Invoice')
      );
      const lines = output.split('\n').filter((line) => line.startsWith('│'));
      const first = lines.findIndex((line) => line.split('│')[1].trim() === '1');
      expect(first).to.be.greaterThan(-1);
      const cells = lines.slice(first).map((line) => line.split('│').slice(1, -1));
      for (const [column, expected] of [
        [2, value.versionName],
        [7, value.runInMode],
        [9, value.capacityCategory],
        [16, value.reasonCode],
      ] as const) {
        const actual = cells
          .map((line) => line[column] ?? '')
          .join('')
          .replace(/\s/gu, '');
        expect(actual).to.equal(expected!.replace(/\s/gu, ''));
      }
      expect(output).not.to.include('…');
    } finally {
      if (prior === undefined) delete process.env.OCLIF_TABLE_COLUMN_OVERRIDE;
      else process.env.OCLIF_TABLE_COLUMN_OVERRIDE = prior;
    }
  });
  it('sanitizes terminal text while keeping the original JSON values', () => {
    const raw = fixture();
    raw.flows[0].apiName = 'Invoice\nFORGED';
    const result = projectVersionList(raw);
    const text = formatVersionListResult(result, 'prod\nFORGED');
    expect(text).not.to.include('\nFORGED');
    expect(result.flows[0].flow).to.equal('Invoice\nFORGED');
  });
});
