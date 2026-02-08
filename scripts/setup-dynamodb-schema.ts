/**
 * DynamoDB Schema Setup Script
 * 
 * Creates the required tables for SharkPark:
 * - sharkpark-main: Stores lots, users, events, weather (single-table design)
 * - sharkpark-timeseries: Stores occupancy events, snapshots, and historical data with TTL
 * 
 * Occupancy Events Storage (in sharkpark-timeseries):
 * - PK: LOT#{lot_id}  |  SK: EVENT#{timestamp}#{event_id}  (individual events)
 * - PK: LOT#{lot_id}  |  SK: SNAPSHOT#{timestamp}  (15-min aggregated snapshots)
 * - PK: DEVICE#{device_hash}  |  SK: LAST_EVENT#{lot_id}  (deduplication tracking)
 * 
 * Usage: pnpm db:setup
 */

/* eslint-disable no-undef */

import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
  DeleteTableCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';

const REGION = process.env.AWS_REGION || 'us-west-2';
const ENDPOINT = process.env.DYNAMO_ENDPOINT || 'http://localhost:8000';

const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
});

async function setupTables() {
  console.log('\nDynamoDB Table Setup\n');
  console.log(`Region: ${REGION}`);
  console.log(`Endpoint: ${ENDPOINT}\n`);

  try {
    const listCommand = new ListTablesCommand({});
    const { TableNames = [] } = await client.send(listCommand);
    console.log('Existing tables:', TableNames.length > 0 ? TableNames : 'None');

    await createMainTable(TableNames);
    await createTimeSeriesTable(TableNames);

    console.log('\nAll tables created successfully\n');
    console.log('Next steps:');
    console.log('  1. Run seed script: pnpm db:seed');
    console.log('  2. Start backend: cd apps/backend && pnpm dev');
    console.log('  3. Test API: curl http://localhost:3000/api/v1/health\n');

  } catch (error) {
    console.error('\n[ERROR] Setup failed:', error);
    process.exit(1);
  }
}

async function createMainTable(existingTables: string[]) {
  const tableName = 'sharkpark-main';

  if (existingTables.includes(tableName)) {
    console.log(`\n[WARN] Table "${tableName}" exists, recreating...`);
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\nCreating table: ${tableName}`);

  const createCommand = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'EntityType', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
      { AttributeName: 'lot_id', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI1-EntityType-Timestamp',
        KeySchema: [
          { AttributeName: 'EntityType', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
      {
        IndexName: 'GSI2-LotID-Timestamp',
        KeySchema: [
          { AttributeName: 'lot_id', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });

  await client.send(createCommand);
  console.log(`[OK] Table created: ${tableName}`);
}

async function createTimeSeriesTable(existingTables: string[]) {
  const tableName = 'sharkpark-timeseries';

  if (existingTables.includes(tableName)) {
    console.log(`\n[WARN] Table "${tableName}" exists, recreating...`);
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\nCreating table: ${tableName}`);
  console.log('  - Used for: occupancy events, snapshots, historical data');
  console.log('  - TTL enabled: items auto-expire after 90 days');

  const createCommand = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'lot_id', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        // GSI for querying events/snapshots by lot and time range
        IndexName: 'GSI1-LotID-Timestamp',
        KeySchema: [
          { AttributeName: 'lot_id', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });

  await client.send(createCommand);
  console.log(`[OK] Table created: ${tableName}`);
  
  // Wait for table to be active before enabling TTL
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const ttlCommand = new UpdateTimeToLiveCommand({
    TableName: tableName,
    TimeToLiveSpecification: {
      Enabled: true,
      AttributeName: 'TTL',
    },
  });
  
  await client.send(ttlCommand);
  console.log('[OK] TTL enabled - items expire after 90 days');
}

setupTables();
