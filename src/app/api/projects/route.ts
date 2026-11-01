import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/errors";
import { createProject } from "@/lib/projects";
import { requireUser } from "@/lib/session";
import { createProjectSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { name } = await parseBody(request, createProjectSchema);
    const project = await createProject(user.id, name);
    return NextResponse.json({ project }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}