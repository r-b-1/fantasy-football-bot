import fs from "node:fs";
import path from "node:path";

export function appendEvent(logPath: string, event: object): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify({ ...event, ts: new Date().toISOString() })}\n`, "utf8");
}
