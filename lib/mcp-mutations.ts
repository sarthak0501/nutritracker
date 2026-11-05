import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";

export class McpMutationError extends Error {}
export const requestIdSchema = z.string().trim().min(1).max(128).describe("Unique ID for this intended change. Reuse the identical ID and arguments after a timeout or retry; use a new ID for a different change.");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Atomic receipt + write. Retries never repeat a mutation or restore deleted data. */
export async function withMcpMutation<T extends object>(userId: string, requestId: string, operation: string, input: unknown,
  writer: (tx: Prisma.TransactionClient) => Promise<T>, client: PrismaClient = prisma): Promise<T> {
  requestIdSchema.parse(requestId);
  const inputHash = createHash("sha256").update(canonical(input)).digest("hex");
  return client.$transaction(async tx => {
    // Serialize MCP writes per account. Row preconditions still protect edits
    // against website writers, which do not participate in this advisory lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp:${userId}`}, 0))`;
    const receipt = await tx.mcpMutation.findUnique({ where: { userId_requestId: { userId, requestId } } });
    if (receipt) {
      if (receipt.operation !== operation || receipt.inputHash !== inputHash) throw new McpMutationError("This request ID was already used for another change. Read the current record and use a new request ID.");
      return receipt.result as T;
    }
    const result = JSON.parse(JSON.stringify(await writer(tx))) as T;
    await tx.mcpMutation.create({ data: { userId, requestId, operation, inputHash, result: result as Prisma.InputJsonValue } });
    return result;
  }, { timeout: 20_000, maxWait: 10_000 });
}
