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

import { stripVTControlCharacters } from 'node:util';
import { Messages, SfError } from '@salesforce/core';
import { FlowVersionError, FlowVersionPruneJobRequestError } from '@salesforce/flow-node';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { loadFlowVersionJobReport } from '../../../../services/flowVersionJobReport.js';
import {
  formatFlowVersionJobReport,
  parseFlowVersionJobResult,
  type FlowVersionJobReport,
} from '../../../../reporters/flowVersionJobReport.js';

export type { FlowVersionJobReport } from '../../../../reporters/flowVersionJobReport.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-flow', 'flow.version.job.report');

const text = (value: string): string => stripVTControlCharacters(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ');

/** Read stored status and results; never submits, resumes, cancels or deletes a job. */
export default class FlowVersionJobReportCommand extends SfCommand<FlowVersionJobReport> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    'job-id': Flags.string({ required: true, summary: messages.getMessage('flags.job-id.summary') }),
  };

  public async run(): Promise<FlowVersionJobReport> {
    const { flags } = await this.parse(FlowVersionJobReportCommand);
    const org = flags['target-org'];
    const connection = org.getConnection(flags['api-version']);
    const operation = await loadFlowVersionJobReport(connection, flags['job-id']).catch((error: unknown): never => {
      if (!(error instanceof FlowVersionError)) throw error;
      const code = error.code;
      const exitCode = code === 'INVALID_PRUNE_JOB_ID' || code === 'PRUNE_JOB_API_VERSION_UNSUPPORTED' ? 2 : 1;
      throw new SfError(text(error.message), code, undefined, exitCode).setData({
        jobId: error instanceof FlowVersionPruneJobRequestError ? error.jobId ?? flags['job-id'] : flags['job-id'],
        statusCode: error instanceof FlowVersionPruneJobRequestError ? error.statusCode : null,
      });
    });
    const report: FlowVersionJobReport = {
      ...parseFlowVersionJobResult(
        operation.status === 'Complete' || operation.status === 'Error' ? operation.result : null
      ),
      jobId: operation.jobId,
      jobStatus: operation.status,
      status: operation.status,
      error: operation.status === 'Error' ? operation.error : null,
      targetOrg: org.getUsername() ?? 'authenticated org',
      apiVersion: connection.getApiVersion(),
    };
    if (!this.jsonEnabled()) this.log(formatFlowVersionJobReport(report));
    process.exitCode = report.status === 'Error' ? 1 : 0;
    return report;
  }
}
