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

import type { Connection } from '@salesforce/core';
import {
  ConnectFlowVersionPruneJobClient,
  FlowVersionError,
  type FlowVersionPruneJobStatus,
} from '@salesforce/flow-node';

export type FlowVersionJobReportSnapshot = {
  jobId: string;
  status: FlowVersionPruneJobStatus;
  result: string | null;
  error: string | null;
};

const isStatus = (value: unknown): value is FlowVersionPruneJobStatus =>
  value === 'Scheduled' || value === 'Running' || value === 'Complete' || value === 'Error';

const invalidResponse = (): never => {
  throw new FlowVersionError(
    'INVALID_FLOW_JOB_REPORT_RESPONSE',
    'The BackgroundOperation record did not provide a valid status, result and error. No deletion outcomes were inferred.'
  );
};

/** Read one job snapshot. Reading a report never submits or resumes work. */
export const loadFlowVersionJobReport = async (
  connection: Connection,
  jobId: string
): Promise<FlowVersionJobReportSnapshot> => {
  // Preserve the existing SDK's job-id, API-version and authenticated-context validation.
  const operation = await new ConnectFlowVersionPruneJobClient(connection).getOperation(jobId);
  if (operation.status === 'Scheduled' || operation.status === 'Running') {
    return { jobId: operation.jobId, status: operation.status, result: null, error: null };
  }

  // The Connect REST representation masks Result and omits Error. Read all three stored
  // fields together so a terminal report uses one consistent BackgroundOperation snapshot.
  const response = await connection.request<unknown>(
    {
      method: 'GET',
      url:
        `/services/data/v${connection.getApiVersion()}/sobjects/BackgroundOperation/` +
        `${encodeURIComponent(operation.jobId)}?fields=Status,Result,Error`,
    },
    { retry: { methods: [], maxRetries: 0 }, followRedirect: false }
  );
  if (response === null || typeof response !== 'object' || Array.isArray(response)) return invalidResponse();
  const row = response as Record<string, unknown>;
  if (!isStatus(row.Status)) return invalidResponse();
  // A newer native snapshot may still be in progress; never report its partial result as final.
  if (row.Status === 'Scheduled' || row.Status === 'Running') {
    return { jobId: operation.jobId, status: row.Status, result: null, error: null };
  }
  if (
    !Object.hasOwn(row, 'Result') ||
    !Object.hasOwn(row, 'Error') ||
    (row.Result !== null && typeof row.Result !== 'string') ||
    (row.Error !== null && typeof row.Error !== 'string') ||
    row.Result === 'MASKED'
  ) {
    return invalidResponse();
  }
  return {
    jobId: operation.jobId,
    status: row.Status,
    result: row.Result,
    error: row.Status === 'Error' ? row.Error : null,
  };
};
