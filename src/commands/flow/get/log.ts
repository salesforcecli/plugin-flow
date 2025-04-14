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

  public static readonly hidden = true;

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
