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
import { Ux } from '@salesforce/sf-plugins-core';

/** Presentation values for the fields required by C1, not an assessment or count provider. */
export type FlowVersionTableRow = {
  versionName: string;
  version: string;
  status: string;
  age: string;
  creator: string;
  createdDate: string;
  lastModifiedDate: string;
  references: string;
  paused: string;
  failed: string;
  deletable: 'Yes' | 'No' | 'Error';
  reason: string;
};

const fields = [
  { key: 'versionName', name: 'Flow Version Name', width: 26 },
  { key: 'version', name: 'Version', width: 9 },
  { key: 'status', name: 'Status', width: 14 },
  { key: 'age', name: 'Age', width: 7 },
  { key: 'creator', name: 'Created By', width: 22 },
  { key: 'createdDate', name: 'Created Date', width: 26 },
  { key: 'lastModifiedDate', name: 'Last Modified Date', width: 26 },
  { key: 'references', name: 'Referenced By', width: 15 },
  { key: 'paused', name: 'Paused Interviews', width: 19 },
  { key: 'failed', name: 'Failed Interviews', width: 19 },
  { key: 'deletable', name: 'Deletable', width: 11 },
  { key: 'reason', name: 'Reason' },
] satisfies Array<{ key: keyof FlowVersionTableRow; name: string; width?: number }>;

const safeText = (value: string): string => stripVTControlCharacters(value).replace(/[\p{Cc}\p{Cf}]/gu, ' ');

const terminalWidth = (requestedWidth?: number): number => {
  const override = Number.parseInt(process.env.OCLIF_TABLE_COLUMN_OVERRIDE ?? '', 10);
  const width = requestedWidth ?? (override > 0 ? override : process.stdout.columns) ?? 160;
  return Number.isFinite(width) && width > 0 ? Math.max(24, Math.floor(width)) : 160;
};

/** Uses the standard Salesforce CLI renderer and wraps every cell rather than dropping C1 information. */
export const formatFlowVersionTable = (rows: FlowVersionTableRow[], requestedWidth?: number): string => {
  if (rows.length === 0) return '';
  const width = terminalWidth(requestedWidth);
  const ux = new Ux({ jsonEnabled: false });
  const data = rows.map((row) => Object.fromEntries(fields.map(({ key }) => [key, safeText(row[key])])));
  if (width >= 260) {
    return ux.makeTable({
      data,
      columns: fields.map((field) => ({ ...field, overflow: 'wrap' as const })),
      maxWidth: width,
      overflow: 'wrap',
    });
  }
  return data
    .map((row) =>
      ux.makeTable({
        data: fields.map(({ key, name }) => ({ field: name, value: row[key] })),
        columns: [
          { key: 'field', name: 'Field', width: Math.min(24, Math.floor(width / 2)), overflow: 'wrap' },
          { key: 'value', name: 'Value', overflow: 'wrap' },
        ],
        maxWidth: width,
        overflow: 'wrap',
      })
    )
    .join('\n\n');
};
