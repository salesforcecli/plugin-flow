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
import { Cache, execCmd } from '@salesforce/cli-plugins-testkit';
import type { FlowVersionJobReport } from '../../../../../src/commands/flow/version/job/report.js';

const pluginRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const validateReport = new Ajv({ allErrors: true }).compile(
  JSON.parse(
    readFileSync(new URL('../../../../../schemas/flow-version-job-report.json', import.meta.url), 'utf8')
  ) as object
);

/** Opt-in read of one existing job; this suite never creates a job or any Flow fixture. */
describe('Flow version job report read-only live-org NUT (requires FLOW_VERSION_JOB_NUT_ID)', function () {
  this.timeout(120_000);
  let settings: { targetOrg: string; apiVersion: string; jobId: string };
  let directory: string | undefined;
  let priorPluginDir: string | undefined;
  let configured = false;

  before(function () {
    const jobId = process.env.FLOW_VERSION_JOB_NUT_ID;
    if (jobId === undefined) {
      this.skip();
      return;
    }
    const targetOrg = process.env.FLOW_VERSION_JOB_NUT_TARGET_ORG;
    const apiVersion = process.env.FLOW_VERSION_JOB_NUT_API_VERSION ?? '67.0';
    // execCmd takes a shell string: bound each value and reject options or shell metacharacters.
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/.test(jobId))
      throw new Error(
        'FLOW_VERSION_JOB_NUT_ID must be a bounded existing job ID beginning with an alphanumeric character.'
      );
    if (targetOrg === undefined || !/^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,254}$/.test(targetOrg))
      throw new Error('Set FLOW_VERSION_JOB_NUT_TARGET_ORG to a bounded authenticated org alias or username.');
    if (!/^\d{2,3}\.0$/.test(apiVersion) || Number(apiVersion) < 67)
      throw new Error('FLOW_VERSION_JOB_NUT_API_VERSION must be a supported API version such as 67.0.');
    if (process.env.TESTKIT_EXECUTABLE_PATH && !isAbsolute(process.env.TESTKIT_EXECUTABLE_PATH))
      throw new Error('Use an absolute TESTKIT_EXECUTABLE_PATH when overriding the isolated local CLI runner.');
    settings = { jobId, targetOrg, apiVersion };
    directory = mkdtempSync(join(tmpdir(), 'flow-version-job-report-nut-'));
    priorPluginDir = Cache.getInstance().get('pluginDir');
    Cache.getInstance().set('pluginDir', pluginRoot);
    configured = true;
  });

  after(() => {
    if (configured) {
      if (priorPluginDir === undefined) Cache.getInstance().delete('pluginDir');
      else Cache.getInstance().set('pluginDir', priorPluginDir);
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('reads the existing job through one compiled CLI invocation and returns the real status', () => {
    const execution = execCmd<FlowVersionJobReport>(
      [
        'flow',
        'version',
        'job',
        'report',
        '--target-org',
        settings.targetOrg,
        '--api-version',
        settings.apiVersion,
        '--job-id',
        settings.jobId,
        '--json',
      ].join(' '),
      {
        cwd: directory!,
        cli: 'inherit',
        timeout: 120_000,
        env: { ...process.env, SF_DISABLE_LOG_FILE: 'true', SF_AUTOUPDATE_DISABLE: 'true' },
      }
    );
    expect(execution.jsonError, 'CLI stdout must contain a single valid JSON envelope').to.equal(undefined);
    if (!execution.jsonOutput) throw new Error('The job report command did not return a JSON envelope.');
    const envelope = execution.jsonOutput;
    expect(validateReport(envelope.result), JSON.stringify(validateReport.errors)).to.equal(true);
    expect(envelope.result.jobId).to.equal(settings.jobId);
    expect(envelope.result.status).to.be.oneOf(['Scheduled', 'Running', 'Complete', 'Error']);
    expect(envelope.result.jobStatus).to.equal(envelope.result.status);
    expect(envelope.result).to.have.all.keys(
      'jobId',
      'jobStatus',
      'status',
      'targetOrg',
      'apiVersion',
      'error',
      'truncated',
      'versions',
      'warnings',
      'notes'
    );
    if (envelope.result.jobStatus === 'Scheduled' || envelope.result.jobStatus === 'Running') {
      expect(envelope.result.versions).to.deep.equal([]);
      expect(envelope.result.error).to.equal(null);
    }
    if (envelope.result.jobStatus !== 'Error') expect(envelope.result.error).to.equal(null);
    const exitCode = envelope.result.status === 'Error' ? 1 : 0;
    expect(execution.shellOutput.code).to.equal(exitCode);
    expect(envelope.status).to.equal(exitCode);
  });
});
