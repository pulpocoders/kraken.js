import { graphqlSchema, wsHandler } from '@kraken.js/aws';
import {
  GQL_COMPLETE,
  GQL_CONNECTION_ACK,
  GQL_CONNECTION_INIT,
  GQL_CONNECTION_TERMINATE,
  GQL_DATA,
  GQL_START,
  GQL_STOP,
  krakenIt,
  KrakenSchema
} from '@kraken.js/core';
import { ApiGatewayManagementApi, DynamoDB } from 'aws-sdk';
import 'jest-dynalite/withDb';

const apiGatewayMock = {
  postToConnection: jest.fn(() => ({
    promise: () => Promise.resolve()
  })),
  deleteConnection: jest.fn(() => ({
    promise: () => Promise.resolve()
  }))
} as unknown as ApiGatewayManagementApi;

const testSchema: KrakenSchema = {
  typeDefs: `
    type Query { hello(name: String): String }
    type Mutation { sendMessage(channel: String, message: String): Message @pub(triggerName: "onMessage#{channel}") }
    type Subscription { onMessage(channel: String): Message @sub(triggerName: "onMessage#{channel}") }
    type Message {
      channel: String
      message: String
    }`,
  resolvers: {
    Query: { hello: (_, { name }) => `hello ${name}` },
    Mutation: { sendMessage: (_, args) => args }
  }
};

const setupTest = () => {
  const dynamoDb = new DynamoDB.DocumentClient({
    endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
    sslEnabled: false,
    region: 'local'
  });

  const kraken = krakenIt([
    graphqlSchema({
      dynamoDb,
      apiGateway: apiGatewayMock,
      connections: { waitForConnectionTimeout: 5 }
    }),
    testSchema
  ]);

  const handler = wsHandler(kraken);
  const connectionId = Math.random().toString(32);
  const execute = (body, routeKey?, headers?) =>
    handler({
      requestContext: {
        connectionId: connectionId,
        domainName: 'domain.fake',
        stage: process.env.STAGE,
        routeKey
      },
      headers,
      body: JSON.stringify(body)
    } as any, null, null);

  return {
    execute,
    connectionId,
    kraken,
    dynamoDb
  };
};

describe('AWS Websocket Handler', () => {
  const wsHeader = 'Sec-WebSocket-Protocol';
  it.each([
    [{}, { body: '', statusCode: 200 }],
    [{ [wsHeader]: 'graphql-ws' }, { body: '', statusCode: 200, headers: { [wsHeader]: 'graphql-ws' } }],
    [{ 'NOT-THE-RIGHT-HEADER': 'graphql-ws' }, { body: '', statusCode: 200 }]
  ])('should respond to connection headers %o with %o', async (headers, response) => {
    const { execute } = setupTest();
    await execute({ type: GQL_CONNECTION_INIT });
    const actual = await execute(null, '$connect', headers);
    expect(actual).toEqual(response);
  });

  it('should cleanup connection and subscriptions on disconnect event', async () => {
    const { execute, dynamoDb } = setupTest();

    await execute({ type: GQL_CONNECTION_INIT });
    await execute({
      id: '1',
      type: GQL_START,
      payload: { query: 'subscription { onMessage(channel: "general") { __typename channel message } }' }
    });

    const { Count: before } = await dynamoDb.scan({
      TableName: 'WsSubscriptions-test',
      Select: 'COUNT'
    }).promise();
    expect(before).toEqual(2);

    await execute(null, '$disconnect');

    const { Count: after } = await dynamoDb.scan({
      TableName: 'WsSubscriptions-test',
      Select: 'COUNT'
    }).promise();
    expect(after).toEqual(0);
  });

  it('should do nothing on ping operation', async () => {
    const { execute } = setupTest();
    await execute({ type: 'ping' });
  });

  it('should fail when operation is run and the connection is not initialized', async () => {
    const { execute, connectionId } = setupTest();
    const actual = execute({ id: '1', type: GQL_START, payload: { query: 'query { hello }' } });
    await expect(actual).rejects.toThrow(`Connection ${connectionId} not found`);
  });

  describe('should successfully execute pub/sub', () => {
    const numOfSubscriptions = 511;
    const { execute, connectionId, dynamoDb } = setupTest();

    beforeEach(async () => {
      await execute({ type: GQL_CONNECTION_INIT });
      for (let s = 0; s < numOfSubscriptions; s++) {
        await execute({
          id: 's' + s,
          type: GQL_START,
          payload: { query: 'subscription { onMessage(channel: "general") { __typename channel message } }' }
        });
      }
      await execute({
        id: '2',
        type: GQL_START,
        payload: { query: 'mutation { sendMessage(channel: "general", message: "hi") { __typename channel message } }' }
      });
      await execute({
        id: '2',
        type: GQL_STOP
      });
      await execute({
        type: GQL_CONNECTION_TERMINATE
      });
    });

    it('respond to initialize the connection', () => {
      expect(apiGatewayMock.postToConnection).toHaveBeenCalledWith({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: GQL_CONNECTION_ACK
        })
      });
    });

    it('broadcast to all subscriptions', () => {
      for (let s = 0; s < numOfSubscriptions; s++) {
        expect(apiGatewayMock.postToConnection).toHaveBeenCalledWith({
          ConnectionId: connectionId,
          Data: JSON.stringify({
            id: 's' + s,
            type: GQL_DATA,
            payload: { data: { onMessage: { __typename: 'Message', channel: 'general', message: 'hi' } } }
          })
        });
      }
    });

    it('respond to the mutation', () => {
      expect(apiGatewayMock.postToConnection).toHaveBeenCalledWith({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          id: '2',
          type: GQL_DATA,
          payload: { data: { sendMessage: { __typename: 'Message', channel: 'general', message: 'hi' } } }
        })
      });
      expect(apiGatewayMock.postToConnection).toHaveBeenCalledWith({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          id: '2',
          type: GQL_COMPLETE
        })
      });
    });

    it('delete the connection from api gateway', () => {
      expect(apiGatewayMock.deleteConnection).toHaveBeenCalledWith({
        ConnectionId: connectionId
      });
    });

    it('cleanup the connection and subscriptions from database', async () => {
      const { Count } = await dynamoDb.scan({
        TableName: 'WsSubscriptions-test',
        Select: 'COUNT'
      }).promise();
      expect(Count).toEqual(0);
    });
  });
});
