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

import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { expect } from 'chai';
import sinon from 'sinon';
import { Org, SfError } from '@salesforce/core';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import Dependencies, {
  formatDependencyReport,
  type DependencyCommandReport,
} from '../../../src/commands/flow/dependencies.js';
import { DependencyService, type DependencyReport } from '../../../src/services/dependencyService.js';

const reportFixture = (): DependencyReport => ({
  generatedAt: '2026-10-21T00:00:00.000Z',
  root: {
    flowName: 'Child',
    namespace: null,
    definitionId: '300xx000000bojNAAQ',
    versionId: '301xx000003Ga19AAC',
    versionNumber: 1,
    status: 'Draft',
  },
  versionPolicy: 'latest',
  scannedFlows: [],
  relationships: [
    {
      direction: 'incoming',
      callerType: 'Flow',
      callerName: 'Parent',
      callerVersion: 1,
      callerStatus: 'Draft',
      targetType: 'FlowDefinition',
      targetName: 'Child',
      elementName: 'Call_Child',
      evidence: 'Flow.Metadata',
    },
  ],
  mcd: { status: 'success', reportedEdges: [], queryCount: 4, limit: 200 },
  warnings: ['Empty dependency-API results do not prove no references.'],
  scope: {
    flowMetadata: 'explicit-flows-only',
    requestedFlowNames: ['Child', 'Parent'],
    orgWideComplete: false,
    apexSourceScanned: false,
  },
});

describe('flow dependencies command', () => {
  const sandbox = sinon.createSandbox();
  let analyze: sinon.SinonStub;
  let log: sinon.SinonStub;
  let logJson: sinon.SinonStub;
  let logToStderr: sinon.SinonStub;
  let report: DependencyReport;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    report = reportFixture();
    report.scannedFlows = [report.root];
    const ux = stubSfCommandUx(sandbox);
    log = ux.log;
    logJson = ux.logJson;
    logToStderr = ux.logToStderr;
    sandbox.stub(Org, 'create').resolves({
      getConnection: () => ({ getApiVersion: () => '67.0', tooling: {} }),
      getUsername: () => 'poc@example.com',
    } as unknown as Org);
    analyze = sandbox.stub(DependencyService.prototype, 'analyze').resolves(report);
  });

  afterEach(() => {
    sandbox.restore();
    process.exitCode = originalExitCode;
  });

  it('passes the explicit scope and version policy to the service and displays evidence', async () => {
    const result = await Dependencies.run([
      '-o',
      'source',
      '-f',
      'Child',
      '--scan-flow',
      'Parent',
      '--version-policy',
      'latest',
      '--api-version',
      '67.0',
    ]);
    expect(analyze.calledOnce).to.equal(true);
    expect(analyze.firstCall.args[0]).to.deep.equal({
      flowName: 'Child',
      namespace: undefined,
      scanFlows: ['Parent'],
      versionPolicy: 'latest',
    });
    expect(result.root).to.deep.equal(report.root);
    expect(log.firstCall.args[0]).to.include('Evidence: Flow.Metadata | Element: Call_Child');
    expect(String(log.firstCall.args[0]).trimStart().split('\n')[0]).to.equal('=== Flow dependencies');
    expect(log.firstCall.args[0]).to.include('Target org: poc@example.com | API: 67.0 | Version policy: latest');
  });

  it('passes arbitrary names, namespace, and repeated caller flags unchanged and renders service-provided names', async () => {
    report.root = {
      ...report.root,
      flowName: 'Invoice_Approval',
      namespace: 'billing',
      versionNumber: 4,
      status: 'Active',
    };
    report.versionPolicy = 'active';
    report.relationships = [
      {
        direction: 'incoming',
        callerType: 'Flow',
        callerName: 'billing__Receipt_Reconciliation',
        callerVersion: 7,
        callerStatus: 'Active',
        targetType: 'FlowDefinition',
        targetName: 'billing__Invoice_Approval',
        elementName: 'Approve_Invoice',
        evidence: 'Flow.Metadata',
      },
      {
        direction: 'incoming',
        callerType: 'Flow',
        callerName: 'billing__Refund_Request',
        callerVersion: 3,
        callerStatus: 'Draft',
        targetType: 'FlowDefinition',
        targetName: 'billing__Invoice_Approval',
        elementName: 'Check_Invoice',
        evidence: 'Flow.Metadata',
      },
    ];
    report.scannedFlows = [report.root];
    report.scope.requestedFlowNames = ['Invoice_Approval', 'Receipt_Reconciliation', 'Refund_Request'];

    const result = await Dependencies.run([
      '-o',
      'source',
      '--flow-name',
      'Invoice_Approval',
      '--namespace',
      'billing',
      '--scan-flow',
      'Receipt_Reconciliation',
      '--scan-flow',
      'Refund_Request',
      '--scan-flow',
      'Receipt_Reconciliation',
      '--version-policy',
      'active',
    ]);

    expect(analyze.calledOnce).to.equal(true);
    expect(analyze.firstCall.args[0]).to.deep.equal({
      flowName: 'Invoice_Approval',
      namespace: 'billing',
      scanFlows: ['Receipt_Reconciliation', 'Refund_Request', 'Receipt_Reconciliation'],
      versionPolicy: 'active',
    });
    expect(result.root).to.deep.equal(report.root);
    expect(result.relationships).to.deep.equal(report.relationships);
    const output = String(log.firstCall.args[0]);
    expect(output).to.include('Root: Invoice_Approval (v4, Active)');
    expect(output).to.include('Flow: billing__Receipt_Reconciliation (v7, Active)');
    expect(output).to.include('Flow: billing__Refund_Request (v3, Draft)');
    expect(output).to.include('-> FlowDefinition: billing__Invoice_Approval');
    expect(output).to.include('Evidence: Flow.Metadata | Element: Approve_Invoice');
    expect(output).not.to.include('FlowDependency_POC_');
    expect(output).not.to.include('Root: Child');
    expect(output).not.to.include('Flow: Parent');
  });

  it('retains all structured scope, warnings, and dependency evidence in JSON without human output', async () => {
    report.mcd.status = 'partial';
    report.mcd.reportedEdges = [
      {
        MetadataComponentId: '01pxx000000AbCdAAK',
        MetadataComponentName: 'CallsChild',
        MetadataComponentType: 'ApexClass',
        MetadataComponentNamespace: null,
        RefMetadataComponentId: report.root.definitionId,
        RefMetadataComponentName: 'Child',
        RefMetadataComponentType: 'FlowDefinition',
        RefMetadataComponentNamespace: null,
      },
    ];
    report.warnings.push('One dependency query was incomplete; Apex source was not scanned.');
    const result = await Dependencies.run(['-o', 'source', '-f', 'Child', '--json']);

    expect(result).to.deep.equal({ ...report, targetOrg: 'poc@example.com', apiVersion: '67.0' });
    expect(result.scope).to.deep.equal({
      flowMetadata: 'explicit-flows-only',
      requestedFlowNames: ['Child', 'Parent'],
      orgWideComplete: false,
      apexSourceScanned: false,
    });
    expect(result.scannedFlows).to.deep.equal([report.root]);
    expect(result.warnings).to.deep.equal(report.warnings);
    expect(result.mcd).to.deep.equal(report.mcd);
    const schema = JSON.parse(
      readFileSync(new URL('../../../schemas/flow-dependencies.json', import.meta.url), 'utf8')
    ) as object;
    const validate = new Ajv({ allErrors: true }).compile(schema);
    expect(validate(result), JSON.stringify(validate.errors)).to.equal(true);
    expect(log.called).to.equal(false);
    expect(logToStderr.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
  });

  for (const status of ['partial', 'failed'] as const) {
    it(`warns in human output when the dependency provider is ${status}, even with no reported relationships`, async () => {
      report.mcd.status = status;
      report.relationships = [];
      report.warnings.push('Transport diagnostic: TEST_SENTINEL_AUTH');
      const original = JSON.parse(JSON.stringify(report)) as DependencyReport;

      const result = await Dependencies.run(['-o', 'source', '-f', 'Child']);

      const output = String(log.firstCall.args[0]);
      expect(output).to.include(`Warning: MetadataComponentDependency results are incomplete (status: ${status}).`);
      expect(output).to.include('An empty section does not prove that no references exist.');
      expect(output).to.include('Use --json for coverage details.');
      expect(output).to.include('None reported within the inspected providers and scan scope.');
      expect(output.indexOf('Warning:')).to.be.lessThan(output.indexOf('=== Incoming references'));
      expect(output).not.to.include('TEST_SENTINEL_AUTH');
      expect(report).to.deep.equal(original);
      expect(result).to.deep.equal({ ...original, targetOrg: 'poc@example.com', apiVersion: '67.0' });
      expect(logJson.called).to.equal(false);
    });
  }

  it('surrounds human errors with stderr blank lines while preserving the required-read error and exit code', async () => {
    analyze.rejects(new SfError('Flow was not readable.', 'FlowReadFailure', undefined, 7));
    try {
      await Dependencies.run(['-o', 'source', '-f', 'Missing']);
      expect.fail('Expected a required-read error.');
    } catch (error) {
      expect((error as Error).message).to.include('Flow was not readable.');
      expect((error as SfError).exitCode).to.equal(7);
    }
    expect(log.called).to.equal(false);
    expect(logJson.called).to.equal(false);
    expect(logToStderr.callCount).to.equal(3);
    expect(logToStderr.firstCall.args).to.deep.equal(['']);
    expect(logToStderr.secondCall.args[0]).to.include('Flow was not readable.');
    expect(logToStderr.thirdCall.args).to.deep.equal(['']);
    expect(process.exitCode).to.equal(7);
  });

  it('returns a JSON error without human whitespace or stderr and preserves the error code', async () => {
    analyze.rejects(new SfError('Flow was not readable.', 'FlowReadFailure', undefined, 7));
    try {
      await Dependencies.run(['-o', 'source', '-f', 'Missing', '--json']);
      expect.fail('Expected a JSON required-read error.');
    } catch (error) {
      expect((error as Error).message).to.include('Flow was not readable.');
      expect((error as SfError).exitCode).to.equal(7);
    }

    expect(log.called).to.equal(false);
    expect(logToStderr.called).to.equal(false);
    expect(logJson.calledOnce).to.equal(true);
    expect(logJson.firstCall.args[0]).to.include({
      name: 'FlowReadFailure',
      message: 'Flow was not readable.',
      exitCode: 7,
      status: 7,
    });
    expect(process.exitCode).to.equal(7);
  });

  it('rejects an unsupported version policy before analyzing', async () => {
    try {
      await Dependencies.run(['-o', 'source', '-f', 'Child', '--version-policy', 'all']);
      expect.fail('Expected flag validation to fail.');
    } catch (error) {
      expect((error as Error).message).to.include('all');
    }
    expect(analyze.called).to.equal(false);
  });

  it('renders exactly the compact human report with a metadata-confirmed incoming relationship', () => {
    const text = formatDependencyReport({ ...report, targetOrg: 'source', apiVersion: '67.0' });
    expect(text).to.equal(
      [
        '',
        '=== Flow dependencies',
        'Target org: source | API: 67.0 | Version policy: latest',
        'Root: Child (v1, Draft)',
        'Definition: 300xx000000bojNAAQ | Version: 301xx000003Ga19AAC',
        '',
        '=== Incoming references',
        '  Flow: Parent (v1, Draft)',
        '    -> FlowDefinition: Child',
        '    Evidence: Flow.Metadata | Element: Call_Child',
        '',
        '=== Outgoing dependencies',
        '  None reported within the inspected providers and scan scope.',
        '',
      ].join('\n')
    );
  });

  it('adds exactly one newline before and after human report content', () => {
    const text = formatDependencyReport({ ...report, targetOrg: 'source', apiVersion: '67.0' });

    expect(text.startsWith('\n=== Flow dependencies\n')).to.equal(true);
    expect(text.endsWith('\n')).to.equal(true);
    expect(text.startsWith('\n\n')).to.equal(false);
    expect(text.endsWith('\n\n')).to.equal(false);
  });

  it('omits the scan list and diagnostic footer from human output without mutating the full report', () => {
    const fullReport = { ...report, targetOrg: 'source', apiVersion: '67.0' };
    const original = JSON.parse(JSON.stringify(fullReport)) as DependencyCommandReport;
    const text = formatDependencyReport(fullReport);

    for (const omitted of [
      '(read-only)',
      'Scan scope:',
      'explicitly selected Flow version(s)',
      'NOT an org-wide impact report',
      'Dependency API:',
      'distinct row(s)',
      'Apex source analysis:',
      '=== Coverage notes',
      'No deployment, activation, Flow execution, or deletion was performed.',
      ...report.warnings,
    ]) {
      expect(text).not.to.include(omitted);
    }
    expect(text).not.to.include('Warning: MetadataComponentDependency');
    expect(fullReport).to.deep.equal(original);
  });

  it('displays outgoing relationships and an empty scoped incoming section in the compact format', () => {
    report.relationships[0].direction = 'outgoing';
    const text = formatDependencyReport({ ...report, targetOrg: 'source', apiVersion: '67.0' });

    expect(text).to.include('=== Incoming references\n  None reported within the inspected providers and scan scope.');
    expect(text).to.include(
      [
        '=== Outgoing dependencies',
        '  Flow: Parent (v1, Draft)',
        '    -> FlowDefinition: Child',
        '    Evidence: Flow.Metadata | Element: Call_Child',
      ].join('\n')
    );
  });

  it('removes terminal control sequences from returned metadata text', () => {
    const unsafe: DependencyCommandReport = { ...report, targetOrg: 'source', apiVersion: '67.0' };
    unsafe.relationships[0].callerName = 'Parent\u001b[31m\nInjected';
    const text = formatDependencyReport(unsafe);
    expect(text).not.to.include('\u001b');
    expect(text).to.include('Parent [31m Injected');
  });
});

describe('Flow dependency JSON contract', () => {
  // Generated from DependencyCommandReport with the schema tool's TypeScript generator.
  const schema = JSON.parse(
    readFileSync(new URL('../../../schemas/flow-dependencies.json', import.meta.url), 'utf8')
  ) as object;
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const commandReport = (): DependencyCommandReport => ({
    ...reportFixture(),
    targetOrg: 'source',
    apiVersion: '67.0',
  });

  it('validates incoming and outgoing evidence without claiming an org-wide scan', () => {
    const report = commandReport();
    report.scannedFlows = [report.root];
    report.relationships.push({
      direction: 'outgoing',
      callerType: 'Flow',
      callerName: 'Child',
      callerId: report.root.versionId,
      callerVersion: 1,
      callerStatus: 'Draft',
      targetType: 'ApexClass',
      targetName: 'ValidateAccount',
      targetId: '01pxx000000AbCdAAK',
      elementName: 'Validate_Account',
      evidence: 'Flow.Metadata',
    });
    expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
    const unsupportedScope = { ...report, scope: { ...report.scope, orgWideComplete: true } };
    expect(validate(unsupportedScope)).to.equal(false);
  });

  it('preserves partial or unavailable provider results and unnamed dependency records', () => {
    for (const status of ['partial', 'failed'] as const) {
      const report = commandReport();
      report.mcd.status = status;
      report.mcd.reportedEdges = [
        {
          MetadataComponentId: null,
          MetadataComponentName: null,
          MetadataComponentType: null,
          MetadataComponentNamespace: null,
          RefMetadataComponentId: report.root.definitionId,
          RefMetadataComponentName: null,
          RefMetadataComponentType: 'FlowDefinition',
          RefMetadataComponentNamespace: null,
        },
      ];
      report.relationships = [
        {
          direction: 'incoming',
          callerType: '(unknown)',
          callerName: '(unknown)',
          targetType: 'FlowDefinition',
          targetName: 'Child',
          evidence: 'MetadataComponentDependency',
        },
      ];
      report.warnings = ['The provider did not complete; these results do not prove the absence of references.'];
      expect(validate(report), JSON.stringify(validate.errors)).to.equal(true);
    }
  });

  it('rejects missing scope and malformed evidence rather than loosening the report contract', () => {
    const missingScope = JSON.parse(JSON.stringify(commandReport())) as Record<string, unknown>;
    delete missingScope.scope;
    expect(validate(missingScope)).to.equal(false);
    const report = commandReport();
    const invalidEvidence = { ...report, relationships: [{ ...report.relationships[0], direction: 'both' }] };
    expect(validate(invalidEvidence)).to.equal(false);
  });

  it('rejects additional auth or transport fields at every report boundary', () => {
    const injectedReports = [
      { ...commandReport(), accessToken: 'TEST_SENTINEL' },
      { ...commandReport(), root: { ...reportFixture().root, refreshToken: 'TEST_SENTINEL' } },
      { ...commandReport(), relationships: [{ ...reportFixture().relationships[0], password: 'TEST_SENTINEL' }] },
      { ...commandReport(), mcd: { ...reportFixture().mcd, rawResponse: { authorization: 'TEST_SENTINEL' } } },
    ];
    for (const report of injectedReports) expect(validate(report)).to.equal(false);
  });
});
