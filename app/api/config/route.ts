import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { getRuntimePublicConfig } from "../../config/runtime";

async function handle() {
  if (process.env.BUILD_MODE !== "export") {
    noStore();
  }
  return NextResponse.json(getRuntimePublicConfig());
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
