import { NextResponse } from "next/server";

const DEFAULT_NEWAPI_PORTAL_URL = "https://xg.mwapi.bond";

function normalizeUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_NEWAPI_PORTAL_URL;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return DEFAULT_NEWAPI_PORTAL_URL;
  }

  return DEFAULT_NEWAPI_PORTAL_URL;
}

export function GET() {
  return NextResponse.json({
    newapi_portal_url: normalizeUrl(process.env.NEWAPI_PORTAL_URL),
  });
}
