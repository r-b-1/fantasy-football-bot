import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, readEvents } from "../src/state/eventLog.js";

describe("append-only event log", () => {
  it("appends typed events and strips secret-like keys", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "events-"));
    const file = path.join(dir, "draft-events.jsonl");
    appendEvent(file, {
      type: "our_turn",
      overallPick: 21,
      apiKey: "should-not-be-stored"
    });
    appendEvent(file, {
      type: "recommendation",
      overallPick: 21,
      candidateId: "puka nacua::WR",
      playerName: "Puka Nacua",
      score: 91.2,
      notes: ["sportslineRating=100.0"]
    });
    appendEvent(file, {
      type: "pick_verified",
      overallPick: 3,
      candidateId: "puka nacua::WR",
      playerName: "Puka Nacua"
    });
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toMatch(/should-not-be-stored/);
    expect(raw.trim().split("\n")).toHaveLength(3);
    const events = readEvents(file);
    expect(events.map((event) => event.type)).toEqual(["our_turn", "recommendation", "pick_verified"]);
  });
});
