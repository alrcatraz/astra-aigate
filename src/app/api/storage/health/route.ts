import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { resolveDataDir } from "@/lib/dataPaths";
import {
  getAppLogRetentionDays,
  getCallLogRetentionDays,
  getCallLogsTableMaxRows,
  getProxyLogsTableMaxRows,
} from "@/lib/logEnv";
import { getDbBackupMaxFiles, getDbBackupRetentionDays } from "@/lib/db/backup";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

/**
 * GET /api/storage/health — Return database storage information.
 * Provides: driver, dbPath, sizeBytes, lastBackupAt, retentionDays
 */
export async function GET() {
  try {
    // Driver-aware: in PostgreSQL mode the health endpoint must report the
    // PG database (a network server), not the on-disk SQLite file which is a
    // stale/scratch artifact in that mode.
    const { getDbDriver, getAsyncDb } = await import("@/lib/db/core");
    const driver = getDbDriver();

    if (driver === "postgres") {
      // Report the live PG database. Row-count/size come straight from PG.
      const pg = getAsyncDb();
      try {
        const dbName = process.env.DATABASE_URL?.match(/\/\/([^/]+)\/([^?]+)/)?.[2] ?? "aigate";
        const stats = (await pg
          .prepare(
            "SELECT pg_database_size(current_database()) AS size, " +
              "(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public') AS tables"
          )
          .get()) as { size: string | number; tables: string | number } | undefined;
        const sizeBytes = Number(stats?.size ?? 0);
        const tableCount = Number(stats?.tables ?? 0);
        return NextResponse.json({
          driver: "postgres",
          dbPath: `postgres://${dbName} (${tableCount} tables)`,
          sizeBytes,
          lastBackupAt: null,
          backupCount: 0,
          retentionDays: {
            app: getAppLogRetentionDays(),
            call: getCallLogRetentionDays(),
          },
          tableMaxRows: {
            callLogs: getCallLogsTableMaxRows(),
            proxyLogs: getProxyLogsTableMaxRows(),
          },
          backupRetention: {
            maxFiles: getDbBackupMaxFiles(),
            days: getDbBackupRetentionDays(),
          },
          dataDir: "postgres",
        });
      } catch (err) {
        // PG unresponsive — degrade gracefully, still report the driver.
        return NextResponse.json({
          driver: "postgres",
          dbPath: process.env.DATABASE_URL?.match(/\/\/([^/]+)\/([^?]+)/)?.[2] ?? "aigate",
          sizeBytes: 0,
          lastBackupAt: null,
          backupCount: 0,
          retentionDays: { app: 7, call: 7 },
          tableMaxRows: { callLogs: 0, proxyLogs: 0 },
          backupRetention: { maxFiles: getDbBackupMaxFiles(), days: getDbBackupRetentionDays() },
          dataDir: "postgres",
        });
      }
    }

    const dataDir = resolveDataDir({});
    const dbFilePath = path.join(dataDir, "storage.sqlite");
    const backupsDir = path.join(dataDir, "db_backups");

    // Get DB file size
    let sizeBytes = 0;
    try {
      if (fs.existsSync(dbFilePath)) {
        const stat = fs.statSync(dbFilePath);
        sizeBytes = stat.size;
      }
    } catch {
      /* ignore */
    }

    // Get last backup info
    let lastBackupAt = null;
    let backupCount = 0;
    try {
      if (fs.existsSync(backupsDir)) {
        const files = fs
          .readdirSync(backupsDir)
          .filter((f) => f.startsWith("db_") && f.endsWith(".sqlite"))
          .sort()
          .reverse();
        backupCount = files.length;
        if (files.length > 0) {
          const latestStat = fs.statSync(path.join(backupsDir, files[0]));
          lastBackupAt = latestStat.mtime.toISOString();
        }
      }
    } catch {
      /* ignore */
    }

    // Get the display path (abbreviated with ~)
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const displayPath = dbFilePath.startsWith(homeDir)
      ? "~" + dbFilePath.slice(homeDir.length)
      : dbFilePath;

    return NextResponse.json({
      driver: "sqlite",
      dbPath: displayPath,
      sizeBytes,
      lastBackupAt,
      backupCount,
      retentionDays: {
        app: getAppLogRetentionDays(),
        call: getCallLogRetentionDays(),
      },
      tableMaxRows: {
        callLogs: getCallLogsTableMaxRows(),
        proxyLogs: getProxyLogsTableMaxRows(),
      },
      backupRetention: {
        maxFiles: getDbBackupMaxFiles(),
        days: getDbBackupRetentionDays(),
      },
      dataDir: dataDir.startsWith(homeDir) ? "~" + dataDir.slice(homeDir.length) : dataDir,
    });
  } catch (error) {
    console.error("[API] Error getting storage health:", error);
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
