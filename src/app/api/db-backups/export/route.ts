import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "os";
import { getDbInstance, getDbDriver, SQLITE_FILE } from "@/lib/db/core";
import { isAuthRequired, isAuthenticated } from "@/shared/utils/apiAuth";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

/**
 * GET /api/db-backups/export — Download the current database as a .sqlite file.
 *
 * Uses SQLite's native backup API to create a consistent snapshot,
 * then streams it as a downloadable attachment.
 *
 * 🔒 Auth-guarded: requires JWT cookie or Bearer API key (finding #258-2).
 */
export async function GET(request: Request) {
  if (await isAuthRequired(request)) {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    // B1: SQLite-native backup API cannot snapshot a Postgres backend — and
    // getDbInstance() degrades to an in-memory scratch DB under DB_DRIVER=postgres.
    // Return a clear 400 instead of silently exporting an empty/non-persistent file.
    if (getDbDriver() === "postgres") {
      return NextResponse.json(
        { error: "Database export is SQLite-only and is unavailable in PostgreSQL mode" },
        { status: 400 }
      );
    }
    if (!SQLITE_FILE || !fs.existsSync(SQLITE_FILE)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 404 });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportFilename = `omniroute-backup-${timestamp}.sqlite`;
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, exportFilename);

    // Use native SQLite backup API for a consistent snapshot
    const db = getDbInstance();
    await db.backup(tmpPath);

    const fileBuffer = fs.readFileSync(tmpPath);

    // Cleanup temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best effort */
    }

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${exportFilename}"`,
        "Content-Length": String(fileBuffer.length),
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch (error) {
    console.error("[API] Error exporting database:", error);
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
