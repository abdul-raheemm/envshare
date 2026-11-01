import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/errors";
import { addMemberByEmail } from "@/lib/projects";
import { requireUser } from "@/lib/session";
import { inviteMemberSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await requireUser();
    const { projectId } = await params;
    const { email } = await parseBody(request, inviteMemberSchema);
    await addMemberByEmail(user.id, projectId, email);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}