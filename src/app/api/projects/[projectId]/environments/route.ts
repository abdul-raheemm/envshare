import { NextResponse } from "next/server";
import { createEnvironment } from "@/lib/environments";
import { errorResponse, parseBody } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { createEnvironmentSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await requireUser();
    const { projectId } = await params;
    const { name } = await parseBody(request, createEnvironmentSchema);
    const environment = await createEnvironment(user.id, projectId, name);
    return NextResponse.json({ environment }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}