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

import { expect } from 'chai';
import {
  formatFlowVersionJobReport,
  parseFlowVersionJobResult,
  type FlowVersionJobReport,
} from '../../src/reporters/flowVersionJobReport.js';

const firstVersion = '301000000000001';
const secondVersion = '301000000000002AAA';
const thirdVersion = '301000000000003';
const fourthVersion = '301000000000004AAA';

const report = (result: string | null, overrides: Partial<FlowVersionJobReport> = {}): FlowVersionJobReport => ({
  ...parseFlowVersionJobResult(result),
  jobId: '08P000000000001',
  jobStatus: 'Complete',
  status: 'Complete',
  error: null,
  targetOrg: 'job-report-unit@example.invalid',
  apiVersion: '69.0',
  ...overrides,
});

describe('Flow version job stored result parser', () => {
  it('preserves the order and exact 15/18-character IDs of named prune outcomes', () => {
    const result = parseFlowVersionJobResult(
      [
        `Account_Onboarding ${firstVersion} DELETED`,
        `Account_Onboarding ${secondVersion} BLOCKED HAS_INTERVIEWS`,
        `Other_Flow ${thirdVersion} FAILED DELETE_ERROR`,
        `Other_Flow ${fourthVersion} NOT ASSESSED OPERATIONAL`,
      ].join('\n')
    );
    expect(result).to.deep.equal({
      truncated: false,
      versions: [
        { flowApiName: 'Account_Onboarding', versionId: firstVersion, outcome: 'DELETED', reason: null },
        {
          flowApiName: 'Account_Onboarding',
          versionId: secondVersion,
          outcome: 'BLOCKED',
          reason: 'HAS_INTERVIEWS',
        },
        { flowApiName: 'Other_Flow', versionId: thirdVersion, outcome: 'FAILED', reason: 'DELETE_ERROR' },
        { flowApiName: 'Other_Flow', versionId: fourthVersion, outcome: 'NOT ASSESSED', reason: 'OPERATIONAL' },
      ],
      warnings: [],
      notes: [],
    });
  });

  it('treats DELETE and BULK_DELETE as Core source labels rather than Flow names or outcomes', () => {
    const result = parseFlowVersionJobResult(
      [
        `DELETE ${firstVersion} DELETED`,
        `DELETE ${secondVersion} BLOCKED ACTIVE_VERSION`,
        `DELETE ${thirdVersion} FAILED DELETE_ERROR`,
        `BULK_DELETE ${fourthVersion} FAILED NOT_FOUND`,
        `BULK_DELETE ${firstVersion} BLOCKED INSUFFICIENT_PERMISSION`,
      ].join('\n')
    );
    expect(result.versions).to.deep.equal([
      { flowApiName: null, versionId: firstVersion, outcome: 'DELETED', reason: null },
      { flowApiName: null, versionId: secondVersion, outcome: 'BLOCKED', reason: 'ACTIVE_VERSION' },
      { flowApiName: null, versionId: thirdVersion, outcome: 'FAILED', reason: 'DELETE_ERROR' },
      { flowApiName: null, versionId: fourthVersion, outcome: 'FAILED', reason: 'NOT_FOUND' },
      { flowApiName: null, versionId: firstVersion, outcome: 'BLOCKED', reason: 'INSUFFICIENT_PERMISSION' },
    ]);
    expect(result.warnings).to.deep.equal([]);
  });

  it('preserves an absent reason as null for every outcome', () => {
    for (const outcome of ['DELETED', 'BLOCKED', 'FAILED', 'NOT ASSESSED']) {
      const result = parseFlowVersionJobResult(`My_Flow ${firstVersion} ${outcome}`);
      expect(result.versions).to.deep.equal([
        { flowApiName: 'My_Flow', versionId: firstVersion, outcome, reason: null },
      ]);
    }
  });

  it('keeps every supplied reason code without replacing it with client eligibility rules', () => {
    for (const reason of [
      'NOT_FOUND',
      'INSUFFICIENT_PERMISSION',
      'DIFFERENT_FLOW',
      'ACTIVE_VERSION',
      'STATUS_NOT_DELETABLE',
      'PACKAGED_VERSION',
      'HAS_INTERVIEWS',
      'HAS_WAIT_CONDITIONS',
      'LAST_VERSION',
      'DELETE_ERROR',
    ]) {
      expect(parseFlowVersionJobResult(`My_Flow ${firstVersion} BLOCKED ${reason}`).versions[0].reason).to.equal(
        reason
      );
    }
  });

  it('parses CRLF results and trailing blank lines without introducing empty versions', () => {
    const result = parseFlowVersionJobResult(`My_Flow ${firstVersion} DELETED\r\n\r\n`);
    expect(result.versions).to.have.length(1);
    expect(result.versions[0].versionId).to.equal(firstVersion);
    expect(result.warnings).to.deep.equal([]);
  });

  it('represents selection and rerun notices as warnings rather than version rows', () => {
    const warningLines = [
      'PRUNE selection stopped before every version was read',
      'PRUNE stopped after 500 versions; run the job again for the rest',
    ];
    const result = parseFlowVersionJobResult(
      [warningLines[0], `My_Flow ${firstVersion} DELETED`, warningLines[1]].join('\n')
    );
    expect(result.versions).to.have.length(1);
    expect(result.warnings).to.deep.equal(warningLines);
    expect(result.truncated).to.equal(false);
  });

  it('retains the explicit no-selection fact without inventing a deleted row', () => {
    const result = parseFlowVersionJobResult('PRUNE selected no versions');
    expect(result).to.deep.equal({
      truncated: false,
      versions: [],
      warnings: [],
      notes: ['PRUNE selected no versions'],
    });
  });

  it('marks a trailing truncation marker and preserves confirmed rows before an incomplete line', () => {
    const result = parseFlowVersionJobResult(
      [`My_Flow ${firstVersion} DELETED`, `My_Flow ${secondVersion} BLOC`, 'result truncated'].join('\n')
    );
    expect(result.truncated).to.equal(true);
    expect(result.versions).to.deep.equal([
      { flowApiName: 'My_Flow', versionId: firstVersion, outcome: 'DELETED', reason: null },
    ]);
    expect(result.warnings).to.have.length(2);
    expect(result.warnings[0]).to.include(`My_Flow ${secondVersion} BLOC`);
    expect(result.warnings[1]).to.equal('result truncated');
  });

  it('does not mark the result truncated when the marker is not the final fact', () => {
    const result = parseFlowVersionJobResult(`result truncated\nMy_Flow ${firstVersion} DELETED`);
    expect(result.truncated).to.equal(false);
    expect(result.versions).to.have.length(1);
  });

  it('does not turn a reason cut by the character limit into a real blocking reason', () => {
    const result = parseFlowVersionJobResult(
      `My_Flow ${firstVersion} DELETED\nMy_Flow ${secondVersion} BLOCKED HAS_INTERV\nresult truncated`
    );
    expect(result.truncated).to.equal(true);
    expect(result.versions).to.deep.equal([
      { flowApiName: 'My_Flow', versionId: firstVersion, outcome: 'DELETED', reason: null },
    ]);
    expect(result.warnings[0]).to.include('BLOCKED HAS_INTERV');
  });

  it('handles truncated assessment reasons without discarding a complete final reason', () => {
    expect(
      parseFlowVersionJobResult(`My_Flow ${firstVersion} NOT ASSESSED OPERA\nresult truncated`).versions
    ).to.deep.equal([]);
    expect(
      parseFlowVersionJobResult(`My_Flow ${firstVersion} BLOCKED HAS_INTERVIEWS\nresult truncated`).versions
    ).to.deep.equal([
      { flowApiName: 'My_Flow', versionId: firstVersion, outcome: 'BLOCKED', reason: 'HAS_INTERVIEWS' },
    ]);
  });

  it('preserves complete future reason codes outside a truncated final fact', () => {
    const line = `My_Flow ${firstVersion} NOT ASSESSED FUTURE_REASON`;
    expect(parseFlowVersionJobResult(line).versions[0].reason).to.equal('FUTURE_REASON');
    const result = parseFlowVersionJobResult(`${line}\nMy_Flow ${secondVersion} BLOCKED HAS_INTERV\nresult truncated`);
    expect(result.versions[0].reason).to.equal('FUTURE_REASON');
    expect(result.versions).to.have.length(1);
  });

  it('does not fabricate outcomes for invalid ids, unsupported outcomes, or extra reason text', () => {
    const lines = [
      'My_Flow 301short DELETED',
      `My_Flow ${firstVersion} UNKNOWN`,
      `My_Flow ${firstVersion} BLOCKED HAS_INTERVIEWS extra`,
      'DELETE FAILED',
    ];
    const result = parseFlowVersionJobResult(lines.join('\n'));
    expect(result.versions).to.deep.equal([]);
    expect(result.warnings).to.have.length(lines.length);
    for (const [index, line] of lines.entries()) expect(result.warnings[index]).to.include(line);
  });

  for (const empty of [null, '', '\n\r\n']) {
    it(`returns no invented outcomes for an empty stored result: ${JSON.stringify(empty)}`, () => {
      expect(parseFlowVersionJobResult(empty)).to.deep.equal({
        truncated: false,
        versions: [],
        warnings: [],
        notes: [],
      });
    });
  }
});

describe('Flow version job report console renderer', () => {
  it('explains an empty stored error without inventing an exception message', () => {
    for (const error of [null, '', '   ']) {
      const input = report(null, { status: 'Error', jobStatus: 'Error', error });
      expect(formatFlowVersionJobReport(input)).to.include('Job error: No error text was stored by the server.');
      expect(input.error).to.equal(error);
    }
  });
  it('shows blocked and failed rows even though the job is Complete', () => {
    const input = report(
      [
        `My_Flow ${firstVersion} DELETED`,
        `My_Flow ${secondVersion} BLOCKED HAS_INTERVIEWS`,
        `My_Flow ${thirdVersion} FAILED DELETE_ERROR`,
      ].join('\n')
    );
    const before = structuredClone(input);
    const output = formatFlowVersionJobReport(input);
    expect(output).to.include('Status: Complete');
    for (const fact of ['My_Flow', firstVersion, secondVersion, thirdVersion, 'DELETED', 'BLOCKED', 'FAILED'])
      expect(output).to.include(fact);
    expect(output.startsWith('\n') && output.endsWith('\n')).to.equal(true);
    expect(input).to.deep.equal(before);
  });

  it('shows the job error after status and before any persisted version outcomes', () => {
    const input = report(`My_Flow ${firstVersion} DELETED`, {
      status: 'Error',
      jobStatus: 'Error',
      error: 'Database request timed out.',
    });
    const output = formatFlowVersionJobReport(input);
    expect(output.indexOf('Status: Error')).to.be.lessThan(output.indexOf('Database request timed out.'));
    expect(output.indexOf('Database request timed out.')).to.be.lessThan(output.indexOf(firstVersion));
    expect(output).to.include('DELETED');
  });

  it('renders truncation and rerun warnings after version rows', () => {
    const input = report(
      [
        `My_Flow ${firstVersion} DELETED`,
        'PRUNE stopped after 500 versions; run the job again for the rest',
        'result truncated',
      ].join('\n')
    );
    const output = formatFlowVersionJobReport(input);
    expect(output.indexOf(firstVersion)).to.be.lessThan(output.indexOf('run the job again'));
    expect(output).to.include('Warning: PRUNE stopped after 500 versions; run the job again for the rest');
    expect(output).to.include('Warning: result truncated');
  });

  it('renders a no-selection note and no invented outcomes for an empty version array', () => {
    const output = formatFlowVersionJobReport(report('PRUNE selected no versions'));
    expect(output).to.include('PRUNE selected no versions');
    expect(output).not.to.include('DELETED');
    expect(output).not.to.include('BLOCKED');
    expect(output).not.to.include('FAILED');
  });

  it('removes terminal controls from console cells, job error, and warnings without mutating JSON facts', () => {
    const input = report(`My_Flow ${firstVersion} FAILED DELETE_ERROR`, {
      status: 'Error',
      jobStatus: 'Error',
      targetOrg: 'unit\u001b[31m@example.invalid\nsecond',
      error: 'Timeout\u001b[0m\u0007\u202e\nDetails',
      warnings: ['warning\u001b[31m\u0007\u202e\nDetails'],
    });
    input.versions[0].flowApiName = 'My_Flow\u001b[31m\u202e';
    const before = structuredClone(input);
    const output = formatFlowVersionJobReport(input);
    // The standard table renderer may add its own colors; untrusted red/control sequences must be gone.
    for (const control of ['\u001b[31m', '\u0007', '\u202e', '\r']) expect(output).not.to.include(control);
    expect(output).not.to.include('\nDetails');
    expect(output).not.to.include('\nsecond');
    expect(input).to.deep.equal(before);
  });
});
