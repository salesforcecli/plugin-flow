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

import { PassThrough } from 'node:stream';
import { expect } from 'chai';
import sinon from 'sinon';
import { Connection, type AuthInfo } from '@salesforce/core';
import { ConnectFlowVersionListClient, FlowVersionError, type FlowVersionListInput } from '@salesforce/flow-node';

const definitionId = '300000000000001AAA';
const creatorId = '005000000000001AAA';
const versionId = (number: number): string => `301${String(number).padStart(12, '0')}AAA`;
const row = (number = 1, changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  versionId: versionId(number).slice(0, 15),
  versionNumber: number,
  versionName: 'Invoice Approval',
  status: 'Draft',
  createdDate: '2026-10-01T12:00:00Z',
  lastModifiedDate: '2026-10-02T12:00:00Z',
  statusChangeDate: '2026-09-01T12:00:00Z',
  ageDays: 26,
  createdById: creatorId.slice(0, 15),
  createdByName: 'Flow Author',
  referenceCount: 0,
  pausedInterviewCount: 0,
  failedInterviewCount: 0,
  deletable: true,
  outcome: 'PASS',
  reasonCode: null,
  message: null,
  ...changes,
});
const page = (
  versions = [row()],
  changes: Record<string, unknown> = {},
  flowChanges: Record<string, unknown> = {}
): Record<string, unknown> => ({
  contractVersion: '1',
  versionLimit: 50,
  returnedVersionCount: versions.length,
  candidateVersionCount: versions.length,
  listTruncated: false,
  nextOffset: null,
  flows: versions.length
    ? [
        {
          definitionId: definitionId.slice(0, 15),
          apiName: 'Invoice_Approval',
          label: 'Invoice Approval',
          versionCount: versions.length,
          limitPercent: versions.length * 2,
          versions,
          ...flowChanges,
        },
      ]
    : [],
  ...changes,
});
type NativeRequest = { method: string; url: string; body?: string; headers?: Record<string, string> };
type Reply = { statusCode: number; body: unknown };
const success = (body: Record<string, unknown>): Reply => ({ statusCode: 201, body });
const requestBody = (request: NativeRequest): Record<string, unknown> =>
  JSON.parse(request.body ?? '{}') as Record<string, unknown>;

// Native parsing and authorization headers are exercised without network or org access.
describe('C1 Core list through the installed authenticated Connection', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const setup = async (replies: Reply[]) => {
    const connection = new Connection({
      authInfo: {
        getUsername: () => 'c1-unit-only@example.invalid',
        getFields: () => ({ orgId: '00D000000000001EAA' }),
      } as AuthInfo,
      connectionOptions: {
        instanceUrl: 'https://flow-list-unit-test.invalid',
        accessToken: 'unit-test-only-not-a-credential',
        version: '67.0',
      },
    });
    await connection.init();
    // eslint-disable-next-line no-underscore-dangle
    const request = sandbox.stub(connection._transport, 'httpRequest').callsFake(() => {
      const response = replies.shift();
      if (!response) throw new Error('Unexpected additional native request');
      return Object.assign(
        Promise.resolve({
          statusCode: response.statusCode,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(response.body),
        }),
        { stream: () => new PassThrough() }
      );
    });
    return { connection, request, client: new ConnectFlowVersionListClient(connection) };
  };

  const expectOnlyList = (request: sinon.SinonStub): void => {
    for (const call of request.getCalls()) {
      const input = call.args[0] as NativeRequest;
      expect(input.method).to.equal('POST');
      expect(input.url).to.equal(
        'https://flow-list-unit-test.invalid/services/data/v67.0/connect/interaction/flow-versions/list'
      );
      expect(input.headers?.Authorization).to.equal('Bearer unit-test-only-not-a-credential');
      expect(JSON.stringify(input.headers ?? {}).toLowerCase()).not.to.match(/uitier|lightning/);
      expect(input.body).not.to.match(/orgId|userId|SOQL|force|skip|targets|expectedDefinitionId/);
      expect(call.args[1]).to.include({ followRedirect: false });
      expect((call.args[1] as { retry: unknown }).retry).to.deep.equal({ methods: [], maxRetries: 0 });
    }
  };

  const rejected = async (
    client: ConnectFlowVersionListClient,
    input: FlowVersionListInput = { all: true }
  ): Promise<FlowVersionError> => {
    let caught: unknown;
    try {
      await client.list(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(FlowVersionError);
    return caught as FlowVersionError;
  };

  it('accepts native HTTP 201 and canonicalizes Core version, definition and creator IDs', async () => {
    const { client, request } = await setup([success(page())]);
    const report = await client.list({ flowName: 'Invoice_Approval' });
    expect(report).to.include({
      contractVersion: '1',
      returnedVersionCount: 1,
      versionLimit: 50,
      catalogComplete: true,
    });
    expect(report.flows[0].definitionId).to.equal(definitionId);
    expect(report.flows[0].versions[0]).to.include({
      versionId: versionId(1),
      createdById: creatorId,
      createdByName: 'Flow Author',
    });
    expect(requestBody(request.firstCall.args[0] as NativeRequest)).to.deep.equal({
      contractVersion: '1',
      flowApiName: 'Invoice_Approval',
      limit: 100,
      offset: 0,
    });
    const headers = (request.firstCall.args[0] as NativeRequest).headers ?? {};
    expect(Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]).to.equal(
      'application/json'
    );
    expectOnlyList(request);
  });

  it('merges Core pages using opaque nextOffset without Tooling or assessment calls', async () => {
    const { client, request } = await setup([
      success(page([row(1)], { candidateVersionCount: 3, nextOffset: 73 }, { versionCount: 3, limitPercent: 6 })),
      success(page([row(2), row(3)], { candidateVersionCount: 3 }, { versionCount: 3, limitPercent: 6 })),
    ]);
    const report = await client.list({ all: true });
    expect(report.returnedVersionCount).to.equal(3);
    expect(report.catalogComplete).to.equal(true);
    expect(report.flows[0].versions.map((version) => version.versionNumber)).to.deep.equal([1, 2, 3]);
    expect(request.getCalls().map((call) => requestBody(call.args[0] as NativeRequest).offset)).to.deep.equal([0, 73]);
    expectOnlyList(request);
  });

  it('forwards scope and filters to Core without computing counts or filtering by local capacity', async () => {
    const { client, request } = await setup([
      success(page([row()], { versionLimit: 25 }, { versionCount: 20, limitPercent: 80 })),
    ]);
    const report = await client.list({
      all: true,
      status: 'oBsolete',
      olderThan: '090d',
      deletable: true,
      minPercent: 80,
    });
    expect(requestBody(request.firstCall.args[0] as NativeRequest)).to.deep.equal({
      contractVersion: '1',
      status: 'Obsolete',
      olderThanDays: 90,
      deletable: true,
      minLimitPercent: 80,
      limit: 100,
      offset: 0,
    });
    expect(report.flows[0]).to.include({ versionCount: 20, limitPercent: 80 });
    expect(report.versionLimit).to.equal(25);
    expectOnlyList(request);
  });

  it('keeps authoritative counts and status-change time independent of message text and last-modified', async () => {
    const { client, request } = await setup([
      success(
        page([
          row(1, {
            outcome: 'BLOCKED',
            deletable: false,
            reasonCode: 'INTERVIEWS',
            message: 'INTERVIEWS (99)',
            referenceCount: 5,
            pausedInterviewCount: 2,
            failedInterviewCount: 3,
          }),
        ])
      ),
    ]);
    const report = await client.list({ all: true });
    expect(report.flows[0].versions[0]).to.include({
      referenceCount: 5,
      pausedInterviewCount: 2,
      failedInterviewCount: 3,
      reasonCode: 'INTERVIEWS',
      message: 'INTERVIEWS (99)',
      statusChangeDate: '2026-09-01T12:00:00Z',
      lastModifiedDate: '2026-10-02T12:00:00Z',
    });
    expect(report.flows[0].versions[0]).not.to.have.property('assessment');
    expect(report.flows[0].versions[0]).not.to.have.property('evidence');
    expectOnlyList(request);
  });

  it('retains PASS, BLOCKED and ERROR independently, including nullable unavailable metadata', async () => {
    const { client, request } = await setup([
      success(
        page([
          row(1),
          row(2, {
            status: 'Active',
            outcome: 'BLOCKED',
            deletable: false,
            reasonCode: 'ACTIVE_VERSION',
            message: 'The active version cannot be deleted.',
          }),
          row(3, {
            status: null,
            ageDays: null,
            outcome: 'ERROR',
            deletable: false,
            reasonCode: 'OPERATIONAL',
            message: null,
            createdDate: null,
            lastModifiedDate: null,
            statusChangeDate: null,
            createdById: null,
            createdByName: null,
            referenceCount: null,
            pausedInterviewCount: null,
            failedInterviewCount: null,
          }),
        ])
      ),
    ]);
    const versions = (await client.list({ all: true })).flows[0].versions;
    expect(versions.map((version) => version.outcome)).to.deep.equal(['PASS', 'BLOCKED', 'ERROR']);
    expect(versions[2]).to.include({
      referenceCount: null,
      pausedInterviewCount: null,
      failedInterviewCount: null,
      statusChangeDate: null,
    });
    expectOnlyList(request);
  });

  it('preserves future Core blocker reasons and messages without a client product branch', async () => {
    const { client, request } = await setup([
      success(
        page([
          row(1, { outcome: 'BLOCKED', deletable: false, reasonCode: 'FUTURE_RULE', message: 'New server policy.' }),
        ])
      ),
    ]);
    const version = (await client.list({ all: true })).flows[0].versions[0];
    expect(version).to.include({ reasonCode: 'FUTURE_RULE', message: 'New server policy.' });
    expectOnlyList(request);
  });

  it('retains terminal truncation and does not certify an incomplete catalog', async () => {
    const { client, request } = await setup([
      success(
        page([row()], { listTruncated: true, candidateVersionCount: 2000 }, { versionCount: 2001, limitPercent: 4002 })
      ),
    ]);
    const report = await client.list({ all: true });
    expect(report.listTruncated).to.equal(true);
    expect(report.catalogComplete).to.equal(false);
    expectOnlyList(request);
  });

  it('supports the inactive compatibility filter without inventing a server status', async () => {
    const { client, request } = await setup([
      success(page([row(1, { status: 'Active' }), row(2, { status: 'Obsolete' })])),
    ]);
    const report = await client.list({ all: true, status: 'inactive' });
    expect(report.flows[0].versions.map((version) => version.versionNumber)).to.deep.equal([2]);
    expect(requestBody(request.firstCall.args[0] as NativeRequest)).not.to.have.property('status');
    expect(report.catalogComplete).to.equal(false);
    expectOnlyList(request);
  });

  for (const [name, changes] of [
    ['non-advancing continuation', { nextOffset: 0 }],
    ['contradictory row count', { returnedVersionCount: 2 }],
    ['unsupported contract', { contractVersion: '2' }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`rejects ${name} instead of manufacturing list results`, async () => {
      const { client, request } = await setup([success(page([row()], changes))]);
      expect((await rejected(client)).code).to.equal('INVALID_LIST_RESPONSE');
      expect(request.calledOnce).to.equal(true);
      expectOnlyList(request);
    });
  }

  it('rejects duplicate versions across pages', async () => {
    const { client, request } = await setup([
      success(page([row()], { candidateVersionCount: 2, nextOffset: 1 }, { versionCount: 2, limitPercent: 4 })),
      success(page([row()], { candidateVersionCount: 2 }, { versionCount: 2, limitPercent: 4 })),
    ]);
    expect((await rejected(client)).code).to.equal('LIST_CHANGED');
    expect(request.callCount).to.equal(2);
    expectOnlyList(request);
  });

  for (const statusCode of [400, 403, 503]) {
    it(`preserves a native HTTP ${statusCode} failure and sends no automatic retry`, async () => {
      const { client, request } = await setup([
        { statusCode, body: [{ errorCode: 'SERVER_REJECTION', message: 'The server rejected this list request.' }] },
      ]);
      const error = await rejected(client);
      expect(error.code).to.equal('SERVER_REJECTION');
      expect(error.message).to.equal('The server rejected this list request.');
      expect(request.calledOnce).to.equal(true);
      expectOnlyList(request);
    });
  }

  it('rejects unsafe selectors before native HTTP', async () => {
    const { client, request } = await setup([]);
    expect((await rejected(client, { flowName: "Invoice' OR Id != null" })).code).to.equal('INVALID_IDENTIFIER');
    expect(request.called).to.equal(false);
  });
});
