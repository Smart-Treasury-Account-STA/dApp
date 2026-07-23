import { NextResponse } from "next/server";

import { requireRelayerAdmin } from "@/lib/relayer/auth";
import { executeRelayerJobById } from "@/lib/relayer/executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ intentId: string }> },
) {
  try {
    requireRelayerAdmin(request);
    const { intentId } = await params;
    const updated = await executeRelayerJobById(intentId);
    return NextResponse.json({ job: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Unauthorized")
      ? 401
      : message.includes("RELAYER_ADMIN_TOKEN")
        ? 503
        : message.includes("not found")
          ? 404
          : 500;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
