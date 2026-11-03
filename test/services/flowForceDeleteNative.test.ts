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
import { ConnectFlowVersionForceDeleteClient, FlowVersionForceDeleteRequestError } from '@salesforce/flow-node';

const token = 'unit-only-opaque-confirmation-never-log';
const orgId = '00D000000000001EAA';
type Reply = { statusCode: number; body: string } | Error | undefined;
type NativeRequest = { method: string; url: string; body?: string; headers?: Record<string, string> };
type LoggerShape = { getRawLogger(): { debug(...values: unknown[]): unknown } };

// Native SDK parsing, request logging and session refresh; all HTTP responses are in-memory fixtures.
describe('C6 force deletion through the installed authenticated Connection', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const setup = async (
    replies: Reply[]
  ): Promise<{
    connection: Connection;
    adapter: ConnectFlowVersionForceDeleteClient;
    request: sinon.SinonStub;
    originalLogger: LoggerShape;
    originalTransport: Connection['_transport'];
    debug: sinon.SinonSpy;
  }> => {
    const connection = new Connection({
      authInfo: {
        getUsername: () => 'c6-unit-only@example.invalid',
        getFields: () => ({ orgId }),
      } as AuthInfo,
      connectionOptions: {
        instanceUrl: 'https://flow-c6-unit-test.invalid',
        accessToken: 'unit-only-not-a-credential',
        version: '67.0',
      },
    });
    await connection.init();
    const originalLogger = (connection as unknown as { logger: LoggerShape }).logger;
    const debug = sandbox.spy(originalLogger.getRawLogger(), 'debug');
    Object.assign(connection, { _logLevel: 'DEBUG' });
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
                : { statusCode: reply.statusCode, body: reply.body, headers: { 'content-type': 'application/json' } }
            );
      return Object.assign(promise, { stream: () => new PassThrough() }) as unknown as ReturnType<
        typeof originalTransport.httpRequest
      >;
    });
    return {
      connection,
      originalLogger,
      originalTransport,
      request,
      debug,
      adapter: new ConnectFlowVersionForceDeleteClient(connection),
    };
  };

  const caught = async (operation: Promise<unknown>): Promise<FlowVersionForceDeleteRequestError> => {
    let failure: unknown;
    try {
      await operation;
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.instanceOf(FlowVersionForceDeleteRequestError);
    return failure as FlowVersionForceDeleteRequestError;
  };

  it('uses native HTTP 201 and exact token-only wire body without logging or mutating shared state', async () => {
    const f = await setup([{ statusCode: 201, body: JSON.stringify({ deleted: true, abandonedInterviewCount: 3 }) }]);
    const result = await f.adapter.executeToken(token);
    expect(result).to.deep.equal({ deleted: true, abandonedInterviewCount: 3 });
    expect(f.request.calledOnce).to.equal(true);
    const native = f.request.firstCall.args[0] as NativeRequest;
    expect(native.method).to.equal('POST');
    expect(native.url).to.equal(
      'https://flow-c6-unit-test.invalid/services/data/v67.0/connect/interaction/flow-versions/force-delete'
    );
    expect(JSON.parse(native.body ?? '') as object).to.deep.equal({ contractVersion: '1', confirmationToken: token });
    expect(native.headers?.Authorization).to.equal('Bearer unit-only-not-a-credential');
    expect(native.headers?.['user-agent']).to.include('sfdx toolbelt');
    expect(native.headers?.['content-type']).to.equal('application/json');
    const options = f.request.firstCall.args[1] as { retry: unknown; followRedirect: boolean };
    expect(options.retry).to.deep.equal({ methods: [], maxRetries: 0 });
    expect(options.followRedirect).to.equal(false);
    expect(f.debug.called).to.equal(false);
    expect((f.connection as unknown as { logger: LoggerShape }).logger).to.equal(f.originalLogger);
    // eslint-disable-next-line no-underscore-dangle
    expect(f.connection._transport).to.equal(f.originalTransport);
    // eslint-disable-next-line no-underscore-dangle
    expect((f.connection as unknown as { _logLevel: string })._logLevel).to.equal('DEBUG');
  });

  it('keeps preview response tokens out of raw SDK logging too', async () => {
    const f = await setup([{ statusCode: 201, body: JSON.stringify({ eligible: true, confirmationToken: token }) }]);
    const response = await f.adapter.previewVersion({
      versionId: '301000000000001AAA',
      expectedDefinitionId: '300000000000001AAA',
    });
    expect(response).to.deep.equal({ eligible: true, confirmationToken: token });
    expect(f.debug.called).to.equal(false);
    const body = JSON.parse((f.request.firstCall.args[0] as NativeRequest).body ?? '') as object;
    expect(body).to.deep.equal({
      contractVersion: '1',
      versionId: '301000000000001AAA',
      expectedDefinitionId: '300000000000001AAA',
    });
  });

  it('does not expose a token echoed by native HTTP 400 in message, stack, cause or serialized error', async () => {
    const f = await setup([{ statusCode: 400, body: JSON.stringify([{ errorCode: 'BAD_REQUEST', message: token }]) }]);
    const error = await caught(f.adapter.executeToken(token));
    expect(error.statusCode).to.equal(400);
    expect(error.outcomeConfirmed).to.equal(true);
    expect(error.requestSent).to.equal(true);
    expect(error.message).not.to.include(token);
    expect(error.stack).not.to.include(token);
    expect(JSON.stringify(error)).not.to.include(token);
    expect(Object.hasOwn(error, 'cause')).to.equal(false);
    expect(f.debug.called).to.equal(false);
    expect(f.request.calledOnce).to.equal(true);
  });

  for (const statusCode of [408, 429, 503]) {
    it(`keeps native HTTP ${statusCode} uncertain and does not retry the mutation`, async () => {
      const f = await setup([{ statusCode, body: JSON.stringify([{ errorCode: 'BAD_REQUEST', message: token }]) }]);
      const error = await caught(f.adapter.executeToken(token));
      expect(error.outcomeConfirmed).to.equal(false);
      expect(error.statusCode).to.equal(statusCode);
      expect(error.message).not.to.include(token);
      expect(f.request.calledOnce).to.equal(true);
    });
  }

  it('preserves native 401 refresh, original authenticated state and final acknowledgement', async () => {
    const f = await setup([
      { statusCode: 401, body: JSON.stringify([{ errorCode: 'INVALID_SESSION_ID', message: 'Expired.' }]) },
      { statusCode: 201, body: JSON.stringify({ deleted: true, abandonedInterviewCount: 3 }) },
    ]);
    const refresh = sandbox.stub().callsFake(async (): Promise<void> => {
      f.connection.accessToken = 'unit-only-refreshed-token';
    });
    Object.assign(f.connection, {
      _refreshDelegate: { isRefreshing: () => false, refresh, waitRefresh: async () => undefined },
    });
    await f.adapter.executeToken(token);
    expect(refresh.calledOnce).to.equal(true);
    expect(f.request.callCount).to.equal(2);
    expect((f.request.secondCall.args[0] as NativeRequest).headers?.Authorization).to.equal(
      'Bearer unit-only-refreshed-token'
    );
    expect(f.connection.accessToken).to.equal('unit-only-refreshed-token');
    expect(f.debug.called).to.equal(false);
    for (const call of f.request.getCalls())
      expect((call.args[1] as { retry: unknown }).retry).to.deep.equal({ methods: [], maxRetries: 0 });
  });

  it('does not mistake a lost refreshed response for the preceding conclusive 401', async () => {
    const f = await setup([
      { statusCode: 401, body: JSON.stringify([{ errorCode: 'INVALID_SESSION_ID', message: 'Expired.' }]) },
      new Error(`Connection lost ${token}`),
    ]);
    Object.assign(f.connection, {
      _refreshDelegate: {
        isRefreshing: () => false,
        refresh: async () => undefined,
        waitRefresh: async () => undefined,
      },
    });
    const error = await caught(f.adapter.executeToken(token));
    expect(error.statusCode).to.equal(null);
    expect(error.outcomeConfirmed).to.equal(false);
    expect(error.message).not.to.include(token);
    expect(f.request.callCount).to.equal(2);
    expect(f.debug.called).to.equal(false);
  });

  it('does not leak raw HTML or network messages through native logger output', async () => {
    const log = sandbox.spy(console, 'log');
    const warn = sandbox.spy(console, 'warn');
    const errorLog = sandbox.spy(console, 'error');
    const f = await setup([{ statusCode: 502, body: `<html>${token}</html>` }]);
    const error = await caught(f.adapter.executeToken(token));
    expect(error.outcomeConfirmed).to.equal(false);
    for (const spy of [log, warn, errorLog, f.debug]) expect(JSON.stringify(spy.args)).not.to.include(token);
    expect(error.message).not.to.include(token);
  });

  it('requires an observed native HTTP 201, not only a plausible acknowledgement body', async () => {
    const f = await setup([{ statusCode: 200, body: JSON.stringify({ deleted: true, abandonedInterviewCount: 3 }) }]);
    const error = await caught(f.adapter.executeToken(token));
    expect(error.outcomeConfirmed).to.equal(false);
    expect(error.statusCode).to.equal(200);
  });

  it('handles an absent native response without a detached unhandled rejection', async () => {
    const f = await setup([undefined]);
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const error = await caught(f.adapter.executeToken(token));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(error.outcomeConfirmed).to.equal(false);
      expect(error.statusCode).to.equal(null);
      expect(unhandled).to.deep.equal([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});
