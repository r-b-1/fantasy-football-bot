const CBS_HOST_SUFFIX = ".cbssports.com";
const CBS_HOST = "cbssports.com";

export function hostnameOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function isAllowedCbsUrl(url: string): boolean {
  try {
    const host = hostnameOf(url);
    return host === CBS_HOST || host.endsWith(CBS_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function isAllowedFixtureUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return parsed.pathname.toLowerCase().includes("fixture-draft-room");
    }
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return local && parsed.pathname.includes("fixture-draft-room");
  } catch {
    return false;
  }
}

export function assertAllowedCbsUrl(url: string): void {
  if (isAllowedFixtureUrl(url)) {
    throw new Error(`Live CBS automation refused a local fixture URL: ${url}`);
  }
  if (!isAllowedCbsUrl(url)) {
    throw new Error(`Refusing to automate a non-CBS URL: ${url}`);
  }
}

export function assertAllowedFixtureUrl(url: string): void {
  if (isAllowedCbsUrl(url)) {
    throw new Error(`Fixture mode refused to touch CBS: ${url}`);
  }
  if (!isAllowedFixtureUrl(url)) {
    throw new Error(`Fixture mode only allows the local fake draft room, not ${url}`);
  }
}

export function leagueOrigin(draftRoomUrlPattern: string): string {
  const host = draftRoomUrlPattern.replace(/^https?:\/\//, "").split("/")[0] ?? draftRoomUrlPattern;
  return `https://${host}/`;
}

export const DEFAULT_CBS_MOCK_DRAFT_URL = "https://mockdraft.football.cbssports.com/";

export function looksLikeCbsMockDraftLobby(url: string): boolean {
  if (!isAllowedCbsUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    if (host !== "mockdraft.football.cbssports.com") return false;
    return path === "/" || path === "/mockdraft";
  } catch {
    return false;
  }
}

export function isAllInTheFamilyHost(url: string): boolean {
  try {
    return hostnameOf(url) === "allfam.football.cbssports.com";
  } catch {
    return false;
  }
}

/** League home, draft-central research, and news feeds are not the live draft room. */
export function looksLikeCbsDraftRoom(url: string): boolean {
  if (!isAllowedCbsUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (looksLikeCbsMockDraftLobby(url)) return false;
    if (/^mockdraft-\d+\./.test(host)) return true;
    if (host.includes("mockdraft") && path.includes("/mockdraft/")) return true;
    if (path.includes("draft-central")) return false;
    if (path.includes("draft-research")) return false;
    return path.includes("/draft/live") || path.includes("/draft/room");
  } catch {
    return false;
  }
}

/** CBS often opens the draft room in a popup. Prefer the live room over draft-central. */
export function pickDraftRoomUrl(urls: string[], preferredPattern?: string): string | null {
  if (preferredPattern) {
    const preferred = urls.find((url) => url.includes(preferredPattern) && looksLikeCbsDraftRoom(url));
    if (preferred) return preferred;
  }
  const mockRoom = urls.find((url) => {
    try {
      return looksLikeCbsDraftRoom(url) && /^mockdraft-\d+\./.test(hostnameOf(url));
    } catch {
      return false;
    }
  });
  if (mockRoom) return mockRoom;
  const live = urls.find((url) => {
    try {
      return looksLikeCbsDraftRoom(url) && new URL(url).pathname.toLowerCase().includes("/draft/live");
    } catch {
      return false;
    }
  });
  if (live) return live;
  return urls.find((url) => looksLikeCbsDraftRoom(url)) ?? null;
}
