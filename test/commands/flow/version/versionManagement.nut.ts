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

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { expect } from 'chai';
import { Cache, execCmd, type JsonOutput } from '@salesforce/cli-plugins-testkit';
import type { FlowVersionListCommandReport } from '../../../../src/commands/flow/version/list.js';
import type { FlowVersionMutationReport } from '../../../../src/reporters/flowVersionMutationReport.js';
import { flowVersionNutSettings, type FlowVersionNutSettings } from '../../../helpers/flowVersionNutSettings.js';

const pluginRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const ajv = new Ajv({ allErrors: true });
const listSchema = ajv.compile(
  JSON.parse(readFileSync(new URL('../../../../schemas/flow-version-list.json', import.meta.url), 'utf8')) as object
);
const mutationSchema = ajv.compile(
  JSON.parse(readFileSync(new URL('../../../../schemas/flow-version-delete.json', import.meta.url), 'utf8')) as object
);
const prerequisite = 'requires FLOW_VERSION_NUT_TARGET_ORG, FLOW_VERSION_NUT_FLOW and FLOW_VERSION_NUT_VERSIONS';

/** Real CLI child processes against an explicitly configured test org; no approval or mutation flags. */
describe(`Flow version read-only live-org NUTs (${prerequisite})`, function () {
  this.timeout(600_000);
  let settings: FlowVersionNutSettings;
  let directory: string | undefined;
  let priorPluginDir: string | undefined;
  let configured = false;
  let beforeIds: string[];
  let definitionId: string;
  let selectedIds: Map<number, string>;

  const execute = <T>(arguments_: string[]): JsonOutput<T> => {
    // Every dynamic argument comes from the bounded fixture parser or an integer derived from it.
    const execution = execCmd<T>(arguments_.join(' '), {
      cwd: directory!,
      cli: 'inherit',
      timeout: 120_000,
      env: { ...process.env, SF_DISABLE_LOG_FILE: 'true', SF_AUTOUPDATE_DISABLE: 'true' },
    });
    expect(execution.jsonError === undefined, 'CLI stdout must be a single valid JSON envelope').to.equal(true);
    if (!execution.jsonOutput)
      throw new Error('CLI did not return a JSON envelope. Check the executable and test-org prerequisites.');
    expect(execution.shellOutput.code, 'JSON status must match the child exit code').to.equal(
      execution.jsonOutput.status
    );
    return execution.jsonOutput;
  };
  const scope = (): string[] => [
    '--target-org',
    settings.targetOrg,
    '--api-version',
    settings.apiVersion,
    '--flow',
    settings.flowApiName,
  ];
  const selection = (): string[] => settings.versions.flatMap((version) => ['--versions', String(version)]);
  const list = (): FlowVersionListCommandReport => {
    const envelope = execute<FlowVersionListCommandReport>(['flow', 'version', 'list', ...scope(), '--json']);
    expect(listSchema(envelope.result), 'C1 output must match its generated command schema').to.equal(true);
    const result = envelope.result;
    const rows = result.flows.flatMap((flow) => flow.versions);
    const incomplete = result.listTruncated || rows.some((row) => row.outcome === 'ERROR');
    expect(envelope.status).to.equal(incomplete ? (rows.some((row) => row.outcome !== 'ERROR') ? 68 : 1) : 0);
    expect(result.listTruncated, 'use a dedicated fixture whose entire version catalog is readable').to.equal(false);
    expect(result.flows).to.have.length(1);
    expect(result.flows[0].apiName).to.equal(settings.flowApiName);
    expect(result.flows[0].versions.length, 'the fixture must have at least one version').to.be.greaterThan(0);
    return result;
  };
  const identities = (report: FlowVersionListCommandReport): string[] =>
    report.flows
      .flatMap((flow) =>
        flow.versions.map((version) => `${flow.definitionId}:${version.versionId}:${version.versionNumber}`)
      )
      .sort();
  const preview = (arguments_: string[], mode: 'NORMAL' | 'RETENTION'): FlowVersionMutationReport => {
    const envelope = execute<FlowVersionMutationReport>(arguments_);
    expect(envelope.status).to.equal(0);
    expect(mutationSchema(envelope.result), 'preview must match the shared public report schema').to.equal(true);
    const result = envelope.result;
    expect(result).to.include({ contractVersion: '3', mode, dryRun: true, confirmed: false, outcome: 'previewed' });
    expect(result).not.to.have.property('plan');
    expect(result).not.to.have.property('deletion');
    expect(result.summary.succeeded).to.equal(0);
    expect(result.results.every((row) => row.outcome === null)).to.equal(true);
    expect(result.execution).to.equal(null);
    return result;
  };
  const assertSelection = (report: FlowVersionMutationReport): void => {
    expect(report.results.map((row) => row.versionNumber).sort((a, b) => a - b)).to.deep.equal(
      [...settings.versions].sort((a, b) => a - b)
    );
    for (const row of report.results) {
      expect(row.flow).to.equal(settings.flowApiName);
      expect(row.definitionId).to.equal(definitionId);
      expect(row.versionId).to.equal(selectedIds.get(row.versionNumber));
      for (const reason of row.blockingReasons) {
        expect(reason.code).to.be.a('string').and.not.equal('');
        expect(reason.count === null || (Number.isSafeInteger(reason.count) && reason.count >= 0)).to.equal(true);
      }
    }
  };

  before(function () {
    const selected = flowVersionNutSettings(process.env);
    if (!selected) {
      this.skip();
      return;
    }
    settings = selected;
    if (process.env.TESTKIT_EXECUTABLE_PATH && !isAbsolute(process.env.TESTKIT_EXECUTABLE_PATH))
      throw new Error('Use an absolute TESTKIT_EXECUTABLE_PATH when overriding the isolated local CLI runner.');
    directory = mkdtempSync(join(tmpdir(), 'flow-version-read-only-nut-'));
    priorPluginDir = Cache.getInstance().get('pluginDir');
    Cache.getInstance().set('pluginDir', pluginRoot);
    configured = true;
    const initial = list();
    beforeIds = identities(initial);
    definitionId = initial.flows[0].definitionId;
    selectedIds = new Map(initial.flows[0].versions.map((row) => [row.versionNumber, row.versionId]));
    for (const version of settings.versions)
      expect(selectedIds.has(version), 'each requested NUT version must exist in the dedicated fixture').to.equal(true);
  });

  afterEach(() => {
    if (configured && beforeIds)
      expect(
        identities(list()),
        'read-only CLI commands must preserve every fixture version and definition ID'
      ).to.deep.equal(beforeIds);
  });

  after(() => {
    if (configured) {
      if (priorPluginDir === undefined) Cache.getInstance().delete('pluginDir');
      else Cache.getInstance().set('pluginDir', priorPluginDir);
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('lists the dedicated Flow through the real compiled CLI', () => {
    const report = list();
    expect(report.scope).to.include({ all: false, flowName: settings.flowApiName });
    expect(identities(report)).to.deep.equal(beforeIds);
  });

  it('includes the dedicated Flow in the org-wide list without inventing eligibility', () => {
    const envelope = execute<FlowVersionListCommandReport>([
      'flow',
      'version',
      'list',
      '--target-org',
      settings.targetOrg,
      '--api-version',
      settings.apiVersion,
      '--all',
      '--json',
    ]);
    expect(listSchema(envelope.result)).to.equal(true);
    expect(envelope.result.scope.all).to.equal(true);
    expect(envelope.result.flows.some((flow) => flow.definitionId === definitionId)).to.equal(true);
    for (const row of envelope.result.flows.flatMap((flow) => flow.versions))
      expect(row.deletable).to.equal(row.outcome === 'PASS');
  });

  it('assesses repeated selected versions with explicit dry-run and preserves their exact IDs', () => {
    assertSelection(
      preview(['flow', 'version', 'delete', ...scope(), ...selection(), '--dry-run', '--json'], 'NORMAL')
    );
  });

  it('implicitly previews normal JSON deletion when approval is absent', () => {
    assertSelection(preview(['flow', 'version', 'delete', ...scope(), ...selection(), '--json'], 'NORMAL'));
  });

  it('implicitly previews normal nonterminal deletion without JSON or approval', () => {
    const execution = execCmd(['flow', 'version', 'delete', ...scope(), ...selection()].join(' '), {
      cwd: directory!,
      cli: 'inherit',
      ensureExitCode: 0,
      timeout: 120_000,
      env: { ...process.env, SF_DISABLE_LOG_FILE: 'true', SF_AUTOUPDATE_DISABLE: 'true' },
    });
    expect(execution.shellOutput.stdout).to.include('No deletion requests were sent.');
    expect(execution.shellOutput.stdout).not.to.include('Process deletion for these');
  });

  it('defaults prune to preview using real catalog versions and an explicit retention policy', () => {
    const report = preview(
      ['flow', 'version', 'prune', ...scope(), '--keep-latest', '1', '--older-than', '0d', '--json'],
      'RETENTION'
    );
    expect(report.rule).to.deep.equal({ keepLatest: 1, olderThan: '0d' });
    expect(
      report.results.map((row) => `${row.definitionId}:${row.versionId}:${row.versionNumber}`).sort()
    ).to.deep.equal(beforeIds);
    const latest = Math.max(...report.results.map((row) => row.versionNumber));
    expect(report.results.find((row) => row.versionNumber === latest)?.action).to.equal('keep');
  });

  it('previews prune --execute in JSON without explicit approval', () => {
    preview(
      ['flow', 'version', 'prune', ...scope(), '--keep-latest', '1', '--older-than', '0d', '--execute', '--json'],
      'RETENTION'
    );
  });

  it('rejects force JSON as usage 2, including a dry-run request', () => {
    const response = execute<never>([
      'flow',
      'version',
      'delete',
      ...scope(),
      '--versions',
      String(settings.versions[0]),
      '--force',
      '--dry-run',
      '--json',
    ]);
    expect(response.status).to.equal(2);
    expect(response.message).to.match(/json/i);
  });

  it('rejects force nonterminal use as usage 2 without executing a force preview', () => {
    const execution = execCmd(
      [
        'flow',
        'version',
        'delete',
        ...scope(),
        '--versions',
        String(settings.versions[0]),
        '--force',
        '--dry-run',
      ].join(' '),
      {
        cwd: directory!,
        cli: 'inherit',
        ensureExitCode: 2,
        timeout: 120_000,
        env: { ...process.env, SF_DISABLE_LOG_FILE: 'true', SF_AUTOUPDATE_DISABLE: 'true' },
      }
    );
    expect(execution.shellOutput.stderr).to.match(/interactive/i);
    expect(execution.shellOutput.stdout).not.to.include('Flow version force deletion');
  });
});
