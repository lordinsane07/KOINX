import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;

/**
 * Connect to the in-memory database server.
 */
export async function connectMemoryDb() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await mongoose.connect(uri);
}

/**
 * Drop database, close the connection and stop the in-memory server.
 */
export async function closeMemoryDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
  }
}

/**
 * Clear all collections from the database (run between tests to ensure isolation).
 */
export async function clearMemoryDb() {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
}
