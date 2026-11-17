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
import { FlowVersionService, ToolingFlowVersionClient, type FlowVersionInventory } from '@salesforce/flow-node';

const definitionId = '300000000000001AAA';
const inventory = (): FlowVersionInventory => ({
  definitionId,
  flowName: 'Disposable_Test_Flow',
  namespace: null,
  versions: [1, 2, 3].map((versionNumber) => ({
    definitionId,
    versionId: `30100000000000${versionNumber}AAA`,
    flowName: 'Disposable_Test_Flow',
    namespace: null,
    versionNumber,
    status: versionNumber === 1 ? 'Active' : 'Draft',
  })),
});

describe('Flow Node through the installed authenticated Connection', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const connectionWithResponse = async (
    statusCode: number,
    body: string,
    orgId = '00D000000000001EAA'
  ): Promise<{ connection: Connection; request: sinon.SinonStub }> => {
    const connection = new Connection({
      authInfo: {
        getUsername: () => 'unit-test-only@example.invalid',
        getFields: () => ({ orgId }),
      } as AuthInfo,
      connectionOptions: {
        instanceUrl: 'https://flow-poc-unit-test.invalid',
        accessToken: 'unit-test-only-not-a-credential',
        version: '67.0',
      },
    });
    await connection.init();
    // Stub below native HTTP error parsing: no request reaches a network or Salesforce org.
    // eslint-disable-next-line no-underscore-dangle
    const request = sandbox.stub(connection._transport, 'httpRequest').callsFake(() =>
      Object.assign(Promise.resolve({ statusCode, headers: { 'content-type': 'application/json' }, body }), {
        stream: () => new PassThrough(),
      })
    );
    return { connection, request };
  };

  it('reads and normalizes the org identity from the native authenticated Connection', async () => {
    const { connection, request } = await connectionWithResponse(204, '', '00D000000000001');
    expect(new ToolingFlowVersionClient(connection).getOrgId()).to.equal('00D000000000001EAA');
    expect(request.called).to.equal(false);
  });

  it('rejects a foreign-org plan before querying or deleting through a native Connection', async () => {
    const { connection, request } = await connectionWithResponse(204, '', '00D000000000002EAA');
    const query = sandbox.stub(connection.tooling, 'query');
    const sourceClient = {
      getOrgId: () => '00D000000000001EAA',
      inventory: async () => inventory(),
      deleteVersion: sandbox.stub().resolves(),
    };
    const plan = await new FlowVersionService(sourceClient).plan({
      flowName: 'Disposable_Test_Flow',
      versions: '2',
    });
    let error: unknown;
    try {
      await new FlowVersionService(new ToolingFlowVersionClient(connection)).execute(plan);
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as { code: string }).code).to.equal('ORG_MISMATCH');
    expect(query.called).to.equal(false);
    expect(request.called).to.equal(false);
    expect(sourceClient.deleteVersion.called).to.equal(false);
  });

  it('accepts the real native 204 response and preserves exact endpoint and retry options', async () => {
    const { connection, request } = await connectionWithResponse(204, '');
    const client = new ToolingFlowVersionClient(connection);
    await client.deleteVersion('301000000000002AAA');

    expect(request.calledOnce).to.equal(true);
    expect(request.firstCall.args[0]).to.include({
      method: 'DELETE',
      url: 'https://flow-poc-unit-test.invalid/services/data/v67.0/tooling/sobjects/Flow/301000000000002AAA',
    });
    expect(request.firstCall.args[1]).to.include({ followRedirect: false });
    const requestOptions = request.firstCall.args[1] as { retry: { methods: string[]; maxRetries: number } };
    expect(requestOptions.retry).to.deep.equal({ methods: [], maxRetries: 0 });
  });

  it('stops after a native 503 error even when its body has a familiar deletion-rejection code', async () => {
    const { connection, request } = await connectionWithResponse(
      503,
      JSON.stringify([{ errorCode: 'DELETE_FAILED', message: 'The server could not establish the outcome.' }])
    );
    const transport = new ToolingFlowVersionClient(connection);
    const service = new FlowVersionService({
      getOrgId: () => '00D000000000001EAA',
      inventory: async () => inventory(),
      deleteVersion: async (versionId) => transport.deleteVersion(versionId),
    });
    const plan = await service.plan({ flowName: 'Disposable_Test_Flow', versions: '2,3' });
    const report = await service.execute(plan);

    expect(report.outcome).to.equal('UNKNOWN');
    expect(report.results.map((result) => result.state)).to.deep.equal(['UNKNOWN', 'NOT_ATTEMPTED']);
    expect(report.results[0].targetDeleted).to.equal(null);
    expect(report.results[0].error?.code).to.equal('DELETE_FAILED');
    expect(request.calledOnce).to.equal(true);
  });
});
