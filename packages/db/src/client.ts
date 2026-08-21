import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

export function createDb(connectionString: string): { prisma: PrismaClient; pool: Pool } {
  // keepAlive guards against long-idle connections (e.g. tunneled through
  // Colima's SSH-based Docker port-forward on local dev) being silently
  // dropped without either side noticing — see wakeup.ts's createKeepAlivePool
  // for the incident this was found from.
  const pool = new Pool({ connectionString, keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
  // An idle client erroring emits 'error' on the pool; with no listener, Node
  // treats that as an uncaught exception and crashes the process.
  pool.on("error", (error) => {
    console.error("[db] pg pool error (recovering):", error);
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

export type { Pool } from "pg";
export * from "./generated/prisma/client.js";
export { Prisma, PrismaClient } from "./generated/prisma/client.js";
