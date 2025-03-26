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
import path from 'node:path';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { config } from 'chai';

config.truncateThreshold = 0;

describe('flow run test', () => {
  let session: TestSession;
  before(async () => {
    session = await TestSession.create({
      project: {
        gitClone: 'https://github.com/trailheadapps/dreamhouse-lwc.git',
      },
      devhubAuthStrategy: 'AUTO',
      scratchOrgs: [
        {
          config: path.join('config', 'project-scratch-def.json'),
          setDefault: true,
          alias: 'org',
        },
      ],
    });

    execCmd('project:deploy:start -o org --source-dir force-app', { ensureExitCode: 0, cli: 'sf' });
  });

  after(async () => {
    await session?.zip(undefined, 'artifacts');
    await session?.clean();
  });
});
