import { DynamoDB, Lambda, SNS, SQS } from 'aws-sdk';
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
    interface Plugins {
      $lambda: Lambda
      $dynamodb: DynamoDB.DocumentClient
      $sqs: SQS
      $sns: SNS
    }

    interface ConnectionInfo {
      apiGatewayUrl: string
      connectedAt?: number
      ttl?: number
    }
  }
}

