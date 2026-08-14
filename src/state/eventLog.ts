import fs from "node:fs";
import path from "node:path";
import { DraftLogEventSchema, stripSecrets, type DraftLogEvent } from "../domain/events.js";

export function appendEvent(logPath: string, event: object): DraftLogEvent {
  const withTs = {
    ...event,
    ts: "ts" in event && typeof event.ts === "string" ? event.ts : new Date().toISOString()
  };
  const parsed = DraftLogEventSchema.parse(stripSecrets(withTs));
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(parsed)}\n`, "utf8");
  return parsed;
}

export function readEvents(logPath: string): DraftLogEvent[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => DraftLogEventSchema.parse(JSON.parse(line)));
}
