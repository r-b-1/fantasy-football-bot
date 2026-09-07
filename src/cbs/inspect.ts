import fs from "node:fs";
import path from "node:path";
import type { Frame, Page } from "playwright";

const ROLES = ["button", "heading", "textbox", "searchbox", "timer", "table", "row", "tab", "link", "status"] as const;

const SKIP_FRAME_HOST =
  /twitter\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com|google\.com|imrworldwide\.com|liadm\.com|agkn\.com|facebook\.com|amazon-adsystem\.com|scorecardresearch\.com/i;

export interface NodeDump {
  tag: string;
  id: string | null;
  testid: string | null;
  role: string | null;
  className: string | null;
  text: string | null;
}

export interface FrameInspect {
  url: string;
  name: string;
  skipped?: boolean;
  error?: string;
  title?: string;
  iframeCount?: number;
  iframeSrcs?: string[];
  bodyPreview?: string;
  interesting?: NodeDump[];
  roles?: Array<{ role: string; count: number; samples: string[] }>;
  textHits?: string[];
}

export function shouldInspectFrame(url: string, name: string): boolean {
  if (!url || url === "about:blank") return false;
  if (name === "_yuiResizeMonitor") return false;
  try {
    return !SKIP_FRAME_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function clip(value: string, max = 120): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** IIFE string: tsx functions inject `__name` into the browser; unevaluated `() =>` strings serialize as undefined. */
const INSPECT_DOM_IIFE = `(() => {
  const textOf = (el) => (el && (el.innerText || el.textContent) || "").replace(/\\s+/g, " ").trim();
  const document = globalThis.document;
  if (!document) return { error: "no document" };
  const nodes = Array.from(document.querySelectorAll(
    "body [id], body [data-testid], body [role], table, thead, tbody, button, input, select, textarea"
  ));
  const seen = new Set();
  const interesting = [];
  for (const el of nodes) {
    const id = el.id || "";
    const testid = el.getAttribute("data-testid") || "";
    const role = el.getAttribute("role") || "";
    const className = (el.className || "").toString();
    const key = el.tagName + "|" + id + "|" + testid + "|" + role + "|" + className.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    interesting.push({
      tag: el.tagName.toLowerCase(),
      id: id || null,
      testid: testid || null,
      role: role || null,
      className: className.slice(0, 120) || null,
      text: textOf(el).slice(0, 120) || null
    });
    if (interesting.length >= 150) break;
  }
  const iframes = Array.from(document.querySelectorAll("iframe"));
  return {
    title: document.title,
    iframeCount: iframes.length,
    iframeSrcs: iframes.slice(0, 20).map(function (el) {
      return el.getAttribute("src") || el.getAttribute("name") || el.id || "(iframe)";
    }),
    bodyPreview: textOf(document.body || document.documentElement).slice(0, 1200),
    interesting: interesting
  };
})()`;

export const CLICK_CONTROLS_IIFE = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && st.visibility !== "hidden" && st.display !== "none";
  };
  const labelOf = (el) =>
    (el.value || el.getAttribute("aria-label") || el.innerText || el.title || "").replace(/\\s+/g, " ").trim();
  const popup = document.getElementById("DraftRoom.views.PlayerPopup");
  const nodes = Array.from(document.querySelectorAll("button, input, a, [role='button']"));
  return {
    popupText: popup ? (popup.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 500) : "",
    popupChildCount: popup ? popup.querySelectorAll("button, input, a").length : 0,
    controls: nodes
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        type: el.getAttribute("type"),
        name: el.getAttribute("name"),
        value: el.getAttribute("value"),
        className: String(el.className || "").slice(0, 80),
        label: labelOf(el).slice(0, 80)
      }))
      .filter((row) => row.label || row.id)
      .slice(0, 80)
  };
})()`;

export interface ClickControlDump {
  popupText: string;
  popupChildCount: number;
  controls: Array<{
    tag: string;
    id: string | null;
    type: string | null;
    name: string | null;
    value: string | null;
    className: string;
    label: string;
  }>;
}

export async function dumpClickControls(page: Page): Promise<ClickControlDump> {
  return page.evaluate(CLICK_CONTROLS_IIFE) as Promise<ClickControlDump>;
}

export function formatClickControlDump(dump: ClickControlDump): string[] {
  const lines = [
    "",
    "Visible click controls (ads skipped in frame dump; this is the main room):",
    `PlayerPopup text: ${dump.popupText || "(empty)"}`,
    `PlayerPopup child buttons/inputs/links: ${dump.popupChildCount}`
  ];
  for (const control of dump.controls) {
    lines.push(
      `  ${control.tag}${control.id ? `#${control.id}` : ""} type=${control.type ?? ""} value=${JSON.stringify(control.value ?? "")} class=${control.className} label=${JSON.stringify(control.label)}`
    );
  }
  return lines;
}

export async function inspectDraftRoom(page: Page): Promise<{ lines: string[]; frames: FrameInspect[] }> {
  const frames: FrameInspect[] = [];
  const lines: string[] = ["", "Live draft-room frame dump (ads/trackers skipped, no cookies):"];
  const allFrames = page.frames();
  lines.push(`Total frames: ${allFrames.length}; inspecting same-origin CBS frames only.`);

  for (const [index, frame] of allFrames.entries()) {
    const info: FrameInspect = { url: frame.url(), name: frame.name() };
    const inspect = index === 0 || shouldInspectFrame(info.url, info.name);
    lines.push(`\n--- frame ${index} name=${info.name || "(none)"} ---`);
    lines.push(`url: ${info.url}`);
    if (!inspect) {
      info.skipped = true;
      lines.push("skipped: ad/tracker/blank frame");
      frames.push(info);
      continue;
    }
    try {
      const dumped = await dumpFrameDom(frame);
      Object.assign(info, dumped);
      lines.push(`title: ${dumped.title ?? ""}`);
      lines.push(`iframes: ${dumped.iframeCount ?? 0} ${(dumped.iframeSrcs ?? []).join(" | ")}`);
      if (dumped.bodyPreview) lines.push(`text: ${dumped.bodyPreview}`);
      if (dumped.textHits && dumped.textHits.length > 0) {
        lines.push(`text hits: ${dumped.textHits.join(" | ")}`);
      }
      for (const role of dumped.roles ?? []) {
        lines.push(`role ${role.role} x${role.count}: ${role.samples.join(" || ")}`);
      }
      for (const node of dumped.interesting ?? []) {
        const loc = [
          node.tag,
          node.id ? `#${node.id}` : "",
          node.testid ? `[data-testid=${node.testid}]` : "",
          node.role ? `role=${node.role}` : "",
          node.className ? `.${node.className.split(" ")[0]}` : ""
        ]
          .filter(Boolean)
          .join(" ");
        lines.push(`  ${loc} :: ${node.text ?? ""}`);
      }
    } catch (error) {
      info.error = error instanceof Error ? error.message : String(error);
      lines.push(`(could not inspect frame: ${info.error})`);
    }
    frames.push(info);
  }

  const clickDump = await dumpClickControls(page).catch(() => null);
  if (clickDump) lines.push(...formatClickControlDump(clickDump));

  return { lines, frames };
}

async function dumpFrameDom(frame: Frame): Promise<Partial<FrameInspect>> {
  const dumped = (await frame.evaluate(INSPECT_DOM_IIFE)) as {
    error?: string;
    title?: string;
    iframeCount?: number;
    iframeSrcs?: string[];
    bodyPreview?: string;
    interesting?: NodeDump[];
  };
  if (dumped?.error) throw new Error(dumped.error);

  return {
    ...dumped,
    roles: await inspectRoles(frame),
    textHits: await collectTextHits(frame)
  };
}

async function inspectRoles(frame: Frame): Promise<Array<{ role: string; count: number; samples: string[] }>> {
  const result: Array<{ role: string; count: number; samples: string[] }> = [];
  for (const role of ROLES) {
    const locator = frame.getByRole(role);
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;
    const samples: string[] = [];
    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const text = clip(await locator.nth(i).innerText().catch(() => ""));
      if (text) samples.push(text);
    }
    result.push({ role, count, samples });
  }
  return result;
}

async function collectTextHits(frame: Frame): Promise<string[]> {
  const patterns = [
    /on the clock/i,
    /you are up/i,
    /draft result/i,
    /round \d/i,
    /\b0:\d{2}\b/,
    /\b\d+:\d{2}\b/,
    /pickens my jeanty/i,
    /who's online/i,
    /roster grid/i,
    /\bppr\b/i,
    /standard roster/i,
    /flex roster/i,
    /\b\d+\s+of\s+\d+\b/i,
    /\b\d+\s*-?\s*teams?\b/i
  ];
  const hits: string[] = [];
  for (const pattern of patterns) {
    const locator = frame.getByText(pattern);
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;
    const sample = clip(await locator.first().innerText().catch(() => pattern.source), 80);
    hits.push(`${pattern.source} x${count} => ${sample}`);
  }
  return hits;
}

export function writeDiagnoseDump(lines: string[], frames: FrameInspect[]): string {
  const dir = path.join(".local");
  fs.mkdirSync(dir, { recursive: true });
  const textPath = path.join(dir, "cbs-diagnose.txt");
  const jsonPath = path.join(dir, "cbs-diagnose.json");
  fs.writeFileSync(textPath, lines.join("\n"), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({ capturedAt: new Date().toISOString(), frames }, null, 2), "utf8");
  return textPath;
}
