export class CbsError extends Error {
  readonly kind:
    | "domain_not_allowed"
    | "selectors_unconfigured"
    | "selector_missing"
    | "selector_unresolved"
    | "parse_failed"
    | "needs_operator_review";
  readonly details: Record<string, unknown>;

  constructor(
    kind:
      | "domain_not_allowed"
      | "selectors_unconfigured"
      | "selector_missing"
      | "selector_unresolved"
      | "parse_failed"
      | "needs_operator_review",
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CbsError";
    this.kind = kind;
    this.details = details;
  }
}

export function domainNotAllowed(url: string): CbsError {
  return new CbsError(
    "domain_not_allowed",
    `Refusing to automate a non-CBS URL: ${url}`,
    { url }
  );
}

export function selectorsUnconfigured(): CbsError {
  return new CbsError(
    "selectors_unconfigured",
    "CBS selectors are not configured. Run npm run cbs:diagnose after logging into the real draft room, then save locators discovered with Playwright MCP/codegen to config/selectors.local.json. Do not guess selectors."
  );
}

export function selectorMissing(field: string): CbsError {
  return new CbsError(
    "selector_missing",
    `CBS selector for ${field} is not configured.`,
    { field }
  );
}

export function selectorUnresolved(field: string, selector: string): CbsError {
  return new CbsError(
    "selector_unresolved",
    `CBS selector for ${field} did not resolve: ${selector}`,
    { field, selector }
  );
}

export function parseFailed(field: string, raw: string): CbsError {
  return new CbsError("parse_failed", `Could not parse CBS ${field} from ${JSON.stringify(raw)}`, {
    field,
    raw
  });
}
