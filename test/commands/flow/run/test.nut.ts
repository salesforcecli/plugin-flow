/*
 * Copyright 2025, Salesforce, Inc.
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
import { join } from 'node:path';
import fs from 'node:fs';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect, config } from 'chai';
config.truncateThreshold = 0;

describe('flow run test', () => {
  let session: TestSession;
  before(async () => {
    session = await TestSession.create({
      project: { sourceDir: join('test', 'mock-projects', 'flow-run-template') },
      devhubAuthStrategy: 'AUTO',
      scratchOrgs: [
        {
          config: join('config', 'project-scratch-def.json'),
          setDefault: true,
          alias: 'org',
        },
      ],
    });

    execCmd('project deploy start -o org --source-dir force-app', { ensureExitCode: 0, cli: 'sf' });
  });

  after(async () => {
    await session?.clean();
  });

  describe('--result-format', () => {
    it('will print tap format', async () => {
      const result = execCmd('flow run test --result-format tap --wait 400', { ensureExitCode: 0 }).shellOutput.stdout;
      expect(result).to.include('1..1');
      expect(result).to.include('ok 1');
      expect(result).to.include('--result-format <format>" to retrieve test results in a different format.');
    });
  });

  it('will create --output-dir', () => {
    const result = execCmd('flow run test --output-dir testresults --code-coverage --wait 100', { ensureExitCode: 0 })
      .shellOutput.stdout;
    expect(result).to.include('Test result files written to testresults');
    const outputDir = join(session.project.dir, 'testresults');
    expect(fs.statSync(outputDir).isDirectory()).to.be.true;
    expect(fs.readdirSync(outputDir).length).to.equal(6);
    expect(fs.existsSync(join(outputDir, 'test-result-codecoverage.json'))).to.be.true;
    expect(fs.existsSync(join(outputDir, 'test-result.txt'))).to.be.true;
    expect(fs.existsSync(join(outputDir, 'test-run-id.txt'))).to.be.true;
  });
});
