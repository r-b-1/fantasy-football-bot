import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_CBS_MOCK_DRAFT_URL,
  isAllInTheFamilyHost,
  isAllowedCbsUrl,
  isCbsMockDraftRoom,
  looksLikeCbsMockDraftLobby
} from "./allowlist.js";

export const MOCK_START_URL_FILE = ".local/mock-start-url.txt";

export function canonicalizeMockDraftUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  const cleaned = parsed.toString().replace(/\/$/, "");
  if (!isAllowedCbsUrl(cleaned) || isAllInTheFamilyHost(cleaned)) {
    throw new Error(`Refusing to persist a non-mock CBS URL: ${url}`);
  }
  if (!isCbsMockDraftRoom(cleaned) && !looksLikeCbsMockDraftLobby(cleaned)) {
    throw new Error(`Refusing to persist a non-mock CBS URL: ${url}`);
  }
  return cleaned;
}

export function persistMockDraftStartUrl(
  url: string,
  filePath = MOCK_START_URL_FILE
): string {
  const cleaned = canonicalizeMockDraftUrl(url);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${cleaned}\n`);
  return cleaned;
}

export function resolveMockDraftStartUrl(filePath = MOCK_START_URL_FILE): string {
  const fromEnv = process.env.CBS_MOCK_DRAFT_URL?.trim();
  if (fromEnv) return canonicalizeMockDraftUrl(fromEnv);

  if (existsSync(filePath)) {
    const fromFile = readFileSync(filePath, "utf8").trim();
    if (fromFile) return canonicalizeMockDraftUrl(fromFile);
  }

  return DEFAULT_CBS_MOCK_DRAFT_URL;
}
