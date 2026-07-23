import { NextResponse } from "next/server";

import { requireRelayerAdmin } from "@/lib/relayer/auth";
import { runDueRelayerJobs } from "@/lib/relayer/executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireRelayerAdmin(request);
    const result = await runDueRelayerJobs();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Unauthorized")
      ? 401
      : message.includes("RELAYER_ADMIN_TOKEN")
        ? 503
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
