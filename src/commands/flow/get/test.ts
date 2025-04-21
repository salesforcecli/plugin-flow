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

import { TestService } from '@salesforce/apex-node';
import { Flags, SfCommand, Ux } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { RunResult, TestReporter } from '../../../reporters/index.js';
import {
  codeCoverageFlag,
  resultFormatFlag,
  outputDirectoryFlag,
  conciseFlag,
  testRunIdFlag,
  detailedCoverageSummaryFlag,
} from '../../../flags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'gettest');
export default class Test extends SfCommand<RunResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'test-run-id': testRunIdFlag,
    'code-coverage': codeCoverageFlag,
    'detailed-coverage': detailedCoverageSummaryFlag,
    'output-dir': outputDirectoryFlag,
    'result-format': resultFormatFlag,
    concise: conciseFlag,
  };

  public async run(): Promise<RunResult> {
    const { flags } = await this.parse(Test);

    const conn = flags['target-org'].getConnection(flags['api-version']);

    const testService = new TestService(conn);
    const result = await testService.reportAsyncResults(flags['test-run-id'], flags['code-coverage']);

    const testReporter = new TestReporter(new Ux({ jsonEnabled: this.jsonEnabled() }), conn);

    return testReporter.report(result, {
      'output-dir': flags['output-dir'],
      'result-format': flags['result-format'],
      json: flags.json,
      'code-coverage': flags['code-coverage'],
      'detailed-coverage': flags['detailed-coverage'],
      concise: flags.concise,
    });
  }
}
