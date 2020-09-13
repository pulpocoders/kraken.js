import { GQL_COMPLETE, GQL_CONNECTION_ACK, GQL_DATA, krakenIt } from '@kraken.js/core';
import { rootPlugins } from './utils';

describe('Kraken Operations', () => {
  const connectionInfo = () => ({
    connectionId: Math.random().toString(32).slice(2)
  });

  const setup = () => {
    return krakenIt([{
      plugins: rootPlugins
    }, {
      typeDefs: [`
        type Query {
          _: String
        }
        type Mutation {
          sendMessage(channel: String, message: String): Message @pub(triggerName: "onMessage#{channel}")
        }
        type Subscription {
          onMessage(channel: String): Message @sub(triggerName: "onMessage#{channel}")
        }
        type Message {
          channel: String
          message: String
        }`
      ],
      resolvers: {
        Mutation: {
          sendMessage: (source, args) => args
        }
      }
    }]);
  };

  it('should execute successfully full cycle operations (start, subscribe, mutate, stop, terminate)', async () => {
    const kraken = setup();
    const connection = connectionInfo();

    await kraken.onGqlInit(connection, {
      type: 'connection_init',
      payload: {}
    });
    for (let i = 0; i < 101; i++) {
      await kraken.onGqlStart(connection, {
        id: 's' + i,
        type: 'start',
        payload: { query: 'subscription { onMessage(channel: "general") { __typename channel message } }' }
      });
    }
    await kraken.onGqlStart(connection, {
      id: '2',
      type: 'start',
      payload: { query: 'subscription { onMessage(channel: "random") { __typename channel message } }' }
    });
    await kraken.onGqlStart(connection, {
      id: '3',
      type: 'start',
      payload: { query: 'mutation { sendMessage(channel: "general", message: "hi") { __typename channel message } }' }
    });
    await kraken.onGqlStop(connection, {
      type: 'stop', id: '2'
    });
    await kraken.onGqlConnectionTerminate(connection);

    // connection accepted
    expect(kraken.$connections.send).toHaveBeenCalledWith(connection, {
      type: GQL_CONNECTION_ACK
    });

    // publish to general channel
    for (let i = 0; i < 101; i++) {
      expect(kraken.$connections.send).toHaveBeenCalledWith(expect.objectContaining(connection), {
        id: 's' + i,
        type: GQL_DATA,
        payload: { data: { onMessage: { __typename: 'Message', channel: 'general', message: 'hi' } } }
      });
    }
    // not publish to random channel
    expect(kraken.$connections.send).not.toHaveBeenCalledWith(expect.objectContaining(connection), {
      id: '2',
      type: GQL_DATA,
      payload: { data: { onMessage: { __typename: 'Message', channel: expect.any(String), message: 'hi' } } }
    });
    // mutation response
    expect(kraken.$connections.send).toHaveBeenCalledWith(expect.objectContaining(connection), {
      id: '3',
      type: GQL_DATA,
      payload: { data: { sendMessage: { __typename: 'Message', channel: 'general', message: 'hi' } } }
    });
    expect(kraken.$connections.send).toHaveBeenCalledWith(expect.objectContaining(connection), {
      id: '3',
      type: GQL_COMPLETE
    });
    // stop subscription
    expect(kraken.$connections.send).toHaveBeenCalledWith(expect.objectContaining(connection), {
      id: '2',
      type: GQL_COMPLETE
    });
  });
});
