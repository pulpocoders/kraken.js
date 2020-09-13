// @ts-ignore
export * as serverless from './resources/serverless.yml';
// @ts-ignore
export * as subscriptions from './resources/serverless-subscriptions.yml';
// @ts-ignore
export * as manifest from './package.json';

export * from './src/ws-handler';
export * from './src/dynamodb-stores';
export * from './src/dynamodb-streams-handler';
export * from './src/schema';

declare global {
  namespace Kraken {
    interface ConnectionInfo {
      apiGatewayUrl: string
      connectedAt?: number
      ttl?: number
    }
  }
}

