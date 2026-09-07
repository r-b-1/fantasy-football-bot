export function stripMarkdownFences(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) return stripMarkdownFences(fenced[1]);

    if (looksLikeJson(trimmed)) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // fall through to brace extraction
      }
    }

    const jsonBlock = extractJsonBlock(trimmed);
    if (jsonBlock != null) {
      try {
        return JSON.parse(jsonBlock);
      } catch {
        return jsonBlock;
      }
    }

    return trimmed.replace(/^\*\*(.+?)\*\*$/s, "$1");
  }
  if (Array.isArray(value)) return value.map(stripMarkdownFences);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripMarkdownFences(v);
    }
    return out;
  }
  return value;
}

function extractJsonBlock(value: string): string | null {
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return value.slice(firstBrace, lastBrace + 1);
}

function looksLikeJson(value: string): boolean {
  const head = value.trimStart()[0];
  return head === "{" || head === "[";
}