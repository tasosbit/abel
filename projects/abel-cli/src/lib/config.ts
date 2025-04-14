// config/env.ts
import { z } from "zod";
import dotenv from "dotenv";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { AbelSDK } from "abel-sdk";
import { accountFromMnemonic } from "./util.js";

// Load .env file into process.env
const envFile = process.env.ENV ? `.env.${process.env.ENV}` : `.env`;
dotenv.config({ path: envFile });

// Define the schema
const envSchema = z.object({
  ALGOD_HOST: z.string().default("https://mainnet-api.4160.nodely.dev"),
  ALGOD_PORT: z.coerce.number().default(443),
  ALGOD_TOKEN: z.string().default(""),
  ASSET_LABEL: z.string().default("pv"),
  MNEMONIC: z.string().optional(),
  ABEL_APP_ID: z.coerce.number(),
  CONCURRENCY: z.coerce.number().default(1),
});

// Parse and validate
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables.");
}

export const config = _env.data;

export const LABEL_ID = config.ASSET_LABEL;

const algodConfig = {
  server: config.ALGOD_HOST,
  port: config.ALGOD_PORT,
  token: config.ALGOD_TOKEN,
};
const algorand = AlgorandClient.fromConfig({ algodConfig });
console.warn("Using algod", algodConfig.server, "concurrency", config.CONCURRENCY);

const writeAccount = config.MNEMONIC ? await accountFromMnemonic(algorand, config.MNEMONIC) : undefined;
console.warn(writeAccount ? `Using account ${writeAccount.addr}` : "No mnemonic, read-only mode");

export const abel = new AbelSDK({
  writeAccount,
  algorand,
  appId: BigInt(config.ABEL_APP_ID),
  concurrency: config.CONCURRENCY,
});
