import { revalidatePath } from "next/cache";
import { createNutriTrackerMcpHandler } from "@/lib/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const handle = createNutriTrackerMcpHandler({ afterWrite: () => {
  for (const path of ["/", "/history", "/trends", "/buddy"]) revalidatePath(path);
} });
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
