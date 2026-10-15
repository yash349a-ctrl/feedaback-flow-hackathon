import path from "node:path";
import dotenv from "dotenv";
import mongoose from "mongoose";

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath, override: false });

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error(`MONGODB_URI is empty. Open ${envPath} and paste the MongoDB Atlas Drivers connection string.`);
    process.exitCode = 1;
    return;
  }
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    console.error("MONGODB_URI must start with mongodb:// or mongodb+srv://. Check server/.env.");
    process.exitCode = 1;
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log(`MongoDB connection successful. Database: ${mongoose.connection.name || "connected"}`);
    await mongoose.disconnect();
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(uri, "[redacted MongoDB URI]") : "Unknown connection error";
    console.error("MongoDB connection failed. Check the Atlas hostname, database username/password, IP Access List, and network/DNS.");
    console.error(message);
    process.exitCode = 1;
    await mongoose.disconnect().catch(() => undefined);
  }
}

void main();
