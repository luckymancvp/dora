import { NextResponse, type NextRequest } from "next/server";
import { requireEmail, errorResponse } from "@/lib/http/api-helpers";
import {
  createImportProfile,
  listImportProfiles,
} from "@/lib/services/tracking-import-profile";
import type { TrackingImportProfileInput } from "@/lib/types/tracking-import";

// GET /api/tracking/import/profiles — danh sách nguồn file đã cấu hình (Printbell, …).
export async function GET() {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;
    const profiles = await listImportProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    return errorResponse(err, "GET /api/tracking/import/profiles");
  }
}

// POST /api/tracking/import/profiles
// body: { name, orderIdColumn, trackingColumn, carrierColumn?, signature? }
export async function POST(req: NextRequest) {
  try {
    const gate = await requireEmail();
    if (gate instanceof NextResponse) return gate;

    const body = (await req.json()) as Partial<TrackingImportProfileInput>;
    const profile = await createImportProfile(
      {
        name: String(body.name ?? ""),
        orderIdColumn: String(body.orderIdColumn ?? ""),
        trackingColumn: String(body.trackingColumn ?? ""),
        carrierColumn: String(body.carrierColumn ?? ""),
        signature: Array.isArray(body.signature) ? body.signature.map(String) : [],
      },
      gate.email,
    );
    return NextResponse.json({ profile });
  } catch (err) {
    return errorResponse(err, "POST /api/tracking/import/profiles");
  }
}
