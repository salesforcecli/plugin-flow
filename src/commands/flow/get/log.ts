/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { LogService } from '@salesforce/apex-node';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { colorLogs } from '../../../logColorize.js';
import { outputDirectoryFlag, numberFlag, logIdFlag } from '../../../flags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'gettest');

export type LogGetResult = Array<{ log: string } | string>;

export default class Log extends SfCommand<LogGetResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly deprecateAliases = true;
  public static readonly aliases = ['force:apex:log:get'];
  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'log-id': logIdFlag,
    number: numberFlag,
    'output-dir': outputDirectoryFlag,
  };

  public async run(): Promise<LogGetResult> {
    const { flags } = await this.parse(Log);
    const conn = flags['target-org'].getConnection(flags['api-version']);
    const logService = new LogService(conn);

    const logResults = await logService.getLogs({
      logId: flags['log-id'],
      numberOfLogs: flags.number,
      outputDir: flags['output-dir'],
    });

    if (logResults.length === 0) {
      this.log(messages.getMessage('noResultsFound'));
      return [];
    }

    if (flags['output-dir']) {
      this.log(`Log files written to ${flags['output-dir']}`);
      // TODO: look at this --outputdir will change what --json returns
      return logResults.map((logResult) => logResult.log);
    }

    return logResults.map((logResult) => {
      this.log(colorLogs(logResult.log));
      return { log: logResult.log };
    });
  }
}
