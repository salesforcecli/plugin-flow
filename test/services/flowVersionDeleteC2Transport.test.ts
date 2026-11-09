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
import { ConnectFlowVersionDeleteClient, FlowVersionDeleteRequestError } from '@salesforce/flow-node';

const versionId = '301000000000002AAA';
const definitionId = '300000000000001AAA';
const targets = [{ versionId, expectedDefinitionId: definitionId }];
type NativeRequest = { method: string; url: string; body?: string; headers?: Record<string, string> };
type Reply = { statusCode: number; body: string } | Error | undefined;

const coreReply = (results: unknown[], statusCode = 201): Reply => ({
  statusCode,
  body: JSON.stringify({ contractVersion: '1', results }),
});
const deleted = (id = versionId, reasonCode: string | null = null) => ({
  versionId: id,
  outcome: 'DELETED',
  reasonCode,
  message: reasonCode === 'ALREADY_DELETED' ? 'This version is already deleted.' : null,
  evidence: [],
});

// Exercise native HTTP parsing and authentication refresh without network or org access.
describe('C2 Core bulk deletion through the installed authenticated Connection', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const setup = async (replies: Reply[]) => {
    const connection = new Connection({
      authInfo: {
        getUsername: () => 'c2-unit-only@example.invalid',
        getFields: () => ({ orgId: '00D000000000001EAA' }),
      } as AuthInfo,
      connectionOptions: {
        instanceUrl: 'https://flow-c2-unit-test.invalid',
        accessToken: 'unit-test-only-not-a-credential',
        version: '67.0',
      },
    });
    await connection.init();
    // eslint-disable-next-line no-underscore-dangle
    const originalTransport = connection._transport;
    const request = sandbox.stub(originalTransport, 'httpRequest').callsFake(() => {
      if (replies.length === 0) throw new Error('Unexpected native HTTP request');
      const reply = replies.shift();
      const promise =
        reply instanceof Error
          ? Promise.reject(reply)
          : Promise.resolve(
              reply === undefined
                ? undefined
                : {
                    statusCode: reply.statusCode,
                    body: reply.body,
                    headers: { 'content-type': 'application/json' },
                  }
            );
      // Deliberately permit a missing native response to verify the protocol failure path.
      return Object.assign(promise, { stream: () => new PassThrough() }) as unknown as ReturnType<
        typeof originalTransport.httpRequest
      >;
    });
    return { connection, originalTransport, request, adapter: new ConnectFlowVersionDeleteClient(connection) };
  };

  const caughtDelete = async (adapter: ConnectFlowVersionDeleteClient): Promise<FlowVersionDeleteRequestError> => {
    let caught: unknown;
    try {
      await adapter.deleteVersions(targets);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(FlowVersionDeleteRequestError);
    return caught as FlowVersionDeleteRequestError;
  };

  it('sends one authenticated POST and accepts Core HTTP 201 without replacing the shared transport', async () => {
    const { connection, adapter, request, originalTransport } = await setup([coreReply([deleted()])]);
    expect(await adapter.deleteVersions(targets)).to.deep.equal([deleted()]);
    expect(request.calledOnce).to.equal(true);
    const native = request.firstCall.args[0] as NativeRequest;
    expect(native.method).to.equal('POST');
    expect(native.url).to.equal(
      'https://flow-c2-unit-test.invalid/services/data/v67.0/connect/interaction/flow-versions/delete'
    );
    expect(JSON.parse(native.body!)).to.deep.equal({ contractVersion: '1', targets });
    expect(native.headers?.Authorization).to.equal('Bearer unit-test-only-not-a-credential');
    expect(Object.entries(native.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]).to.equal(
      'application/json'
    );
    const options = request.firstCall.args[1] as {
      followRedirect: boolean;
      retry: { methods: string[]; maxRetries: number };
      transport: unknown;
    };
    expect(options.followRedirect).to.equal(false);
    expect(options.retry).to.deep.equal({ methods: [], maxRetries: 0 });
    expect(options.transport).not.to.equal(originalTransport);
    // eslint-disable-next-line no-underscore-dangle
    expect(connection._transport).to.equal(originalTransport);
  });

  it('preserves mixed Core outcomes in request order, including an already deleted acknowledgement', async () => {
    const ids = [versionId, '301000000000003AAA', '301000000000004AAA', '301000000000005AAA'];
    const results = [
      deleted(ids[0]),
      { ...deleted(ids[1]), outcome: 'BLOCKED', reasonCode: 'HAS_INTERVIEWS', message: 'Saved interviews remain.' },
      { ...deleted(ids[2]), outcome: 'ERROR', reasonCode: 'DELETE_ERROR', message: 'Deletion failed.' },
      deleted(ids[3], 'ALREADY_DELETED'),
    ];
    const { adapter, request } = await setup([coreReply(results)]);
    expect(
      await adapter.deleteVersions(ids.map((id) => ({ versionId: id, expectedDefinitionId: definitionId })))
    ).to.deep.equal(results);
    expect(request.calledOnce).to.equal(true);
  });

  it('retains a conclusive native HTTP 400 rejection after the SDK drops the status', async () => {
    const { adapter, request } = await setup([
      { statusCode: 400, body: JSON.stringify([{ errorCode: 'BAD_REQUEST', message: 'contractVersion must be 1' }]) },
    ]);
    const error = await caughtDelete(adapter);
    expect(error.code).to.equal('BAD_REQUEST');
    expect(error.message).to.equal('contractVersion must be 1');
    expect(error.statusCode).to.equal(400);
    expect(error.outcomeConfirmed).to.equal(true);
    expect(error.requestSent).to.equal(true);
    expect(request.calledOnce).to.equal(true);
  });

  it('keeps a native HTTP 503 uncertain even when its code resembles a per-item error', async () => {
    const { adapter, request } = await setup([
      {
        statusCode: 503,
        body: JSON.stringify([{ errorCode: 'DELETE_ERROR', message: 'The outcome is unavailable.' }]),
      },
    ]);
    const error = await caughtDelete(adapter);
    expect(error.code).to.equal('DELETE_ERROR');
    expect(error.statusCode).to.equal(503);
    expect(error.outcomeConfirmed).to.equal(false);
    expect(request.calledOnce).to.equal(true);
  });

  it('reports a missing native response without a detached unhandled rejection', async () => {
    const { adapter, request } = await setup([undefined]);
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const error = await caughtDelete(adapter);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(error.code).to.equal('UNKNOWN_DELETE_OUTCOME');
      expect(error.outcomeConfirmed).to.equal(false);
      expect(error.statusCode).to.equal(null);
      expect(error.requestSent).to.equal(true);
      expect(request.calledOnce).to.equal(true);
      expect(unhandled).to.deep.equal([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('preserves native session refresh and the final HTTP 201 acknowledgement', async () => {
    const { connection, adapter, request, originalTransport } = await setup([
      { statusCode: 401, body: JSON.stringify([{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired.' }]) },
      coreReply([deleted()]),
    ]);
    const refresh = sandbox.stub().resolves();
    Object.assign(connection, {
      _refreshDelegate: { isRefreshing: () => false, refresh, waitRefresh: async () => undefined },
    });
    await adapter.deleteVersions(targets);
    expect(refresh.calledOnce).to.equal(true);
    expect(request.callCount).to.equal(2);
    // eslint-disable-next-line no-underscore-dangle
    expect(connection._transport).to.equal(originalTransport);
    for (const call of request.getCalls()) {
      expect((call.args[0] as NativeRequest).method).to.equal('POST');
      expect((call.args[1] as { retry: unknown }).retry).to.deep.equal({ methods: [], maxRetries: 0 });
    }
  });

  it('does not reuse a stale 401 status when the refreshed POST loses its response', async () => {
    const { connection, adapter, request } = await setup([
      { statusCode: 401, body: JSON.stringify([{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired.' }]) },
      new Error('Connection closed before the response arrived.'),
    ]);
    const refresh = sandbox.stub().resolves();
    Object.assign(connection, {
      _refreshDelegate: { isRefreshing: () => false, refresh, waitRefresh: async () => undefined },
    });
    const error = await caughtDelete(adapter);
    expect(refresh.calledOnce).to.equal(true);
    expect(request.callCount).to.equal(2);
    expect(error.outcomeConfirmed).to.equal(false);
    expect(error.statusCode).to.equal(null);
    expect(error.requestSent).to.equal(true);
  });

  for (const statusCode of [408, 429]) {
    it(`does not certify or retry a native HTTP ${statusCode} response`, async () => {
      const { adapter, request } = await setup([
        { statusCode, body: JSON.stringify([{ errorCode: 'DELETE_ERROR', message: 'Request was interrupted.' }]) },
      ]);
      const error = await caughtDelete(adapter);
      expect(error.outcomeConfirmed).to.equal(false);
      expect(error.statusCode).to.equal(statusCode);
      expect(request.calledOnce).to.equal(true);
    });
  }

  for (const [name, response] of [
    ['missing item', coreReply([])],
    ['wrong identity', coreReply([deleted('301000000000003AAA')])],
    ['old HTTP 204', { statusCode: 204, body: '' }],
    ['wrong HTTP 200', coreReply([deleted()], 200)],
  ] as Array<[string, Reply]>) {
    it(`reports ${name} as an uncertain mutation and sends no retry`, async () => {
      const { adapter, request } = await setup([response]);
      const error = await caughtDelete(adapter);
      expect(error.outcomeConfirmed).to.equal(false);
      expect(error.requestSent).to.equal(true);
      expect(request.calledOnce).to.equal(true);
    });
  }

  it('does not expose HTML or credential-like native error messages', async () => {
    const { adapter } = await setup([{ statusCode: 502, body: '<html>Authorization Bearer private-value</html>' }]);
    const error = await caughtDelete(adapter);
    expect(error.message).not.to.include('private-value');
    expect(error.message).not.to.include('<html>');
    expect(error.outcomeConfirmed).to.equal(false);
  });
});
