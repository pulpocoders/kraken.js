import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import DataLoader from 'dataloader';

export type DynamodbDataloader = DataLoader<GetRequest, DocumentClient.AttributeMap | null>

interface GetRequest {
  TableName: string;
  Key: DocumentClient.Key;
}

const maxBatchSize = 25;

const unique = <T>(array: ReadonlyArray<T>): ReadonlyArray<T> => {
  return array.filter((e1, i, self) => {
    return self.findIndex(e2 => Object.keys(e2).every(prop => e2[prop] == e1[prop])) == i;
  });
};

const groupBy = <T>(array: ReadonlyArray<T>, property: keyof T): Record<keyof T, T[]> => {
  return array.reduce((groupedBy, item: T) => {
    const key = item[property] as unknown as string;
    if (!groupedBy[key]) groupedBy[key] = [];
    groupedBy[key].push(item);
    return groupedBy;
  }, {} as Record<keyof T, T[]>);
};

const batchLoadFn = ({ $dynamoDb }: Kraken.Context): DataLoader.BatchLoadFn<GetRequest, DocumentClient.AttributeMap> =>
  async (getRequests) => {
    const byTableName = groupBy(getRequests, 'TableName');
    const requestItems = Object.keys(byTableName).reduce((req, tableName) => {
      const nonUniqueKeys = byTableName[tableName].map(e => e.Key);
      const uniqueKeys = unique(nonUniqueKeys);
      req[tableName] = { Keys: uniqueKeys };
      return req;
    }, {});

    const results = await $dynamoDb
      .batchGet({ RequestItems: requestItems })
      .promise();

    return getRequests.map((getRequest: GetRequest) => {
      const criteria = Object.entries(getRequest.Key);
      const findByKey = items => items.find(item => criteria.every(([key, value]) => item[key] === value));

      if (results.Responses) {
        const responses = results.Responses[getRequest.TableName];
        if (responses) {
          const found = findByKey(responses);
          if (found) return found;
        }
      }

      if (results.UnprocessedKeys) {
        const tableResults = results.UnprocessedKeys[getRequest.TableName];
        if (tableResults) {
          const notFound = findByKey(tableResults.Keys);
          if (notFound) return new Error(`The item with key ${notFound} was not processed`);
        }
      }

      return null;
    });
  };

export const dynamoDbDataLoader = (context: Kraken.Context): DynamodbDataloader => {
  const cacheKeyFn = function({ TableName, Key }) {
    return TableName + '|' + Object.keys(Key).sort().map(k => k + ':' + Key[k]).join('|');
  };

  return new DataLoader<GetRequest, any, string>(batchLoadFn(context), { maxBatchSize, cacheKeyFn });
};
