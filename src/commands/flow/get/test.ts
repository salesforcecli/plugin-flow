/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
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
  public static readonly deprecateAliases = true;
  public static readonly aliases = ['force:flow:test:report'];

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
