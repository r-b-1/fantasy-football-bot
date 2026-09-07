# FantasyPros API Findings

Research date: September 7, 2026.

## Scope and Safety

The initial research used public, official FantasyPros documentation, help pages,
and terms without credentials or API data calls. The subsequently authorized live
tests and implementation are recorded below. The API key was loaded privately by
the application and never printed or stored in source code, caches, or diagnostics.

The user reports a free key named `FANTASY_PROS_API` in `.env` and an allowance of **500 queries**. Those are user-supplied facts, not independently inspected account details. The applicable period, remaining balance, and key-specific entitlements are unknown.

**Evidence labels:** "Confirmed" means stated in a cited official source, not verified against a live response. "Unknown" means the reviewed public sources do not establish it. Recommendations are explicitly identified and are not provider requirements.

## Live Findings and Implemented Commands

**Three API request attempts were made. No further calls were made.** The third
was separately approved after the projection schema failure. The provider's
remaining balance and reset period are still unknown; do not interpret our local
attempt counter as an account balance.

| Attempt | Request | Observed result |
| --- | --- | --- |
| 1 | 2026 NFL consensus rankings, ALL, PRESEASON, PPR, week 0 | HTTP 200. Envelope reported 543 players, 125 experts, year 2026, week 0, PPR, and `ranking_type_name: draft`; only 10 player rows were returned. No quota headers were present among the standard rate-limit header names checked. |
| 2 | 2026 NFL RB projections, week 0, `ros=false` | HTTP 200, but the initial documented-schema parser rejected the response. No projections were imported. |
| 3 | Same RB projections request, with private sanitized diagnostics | HTTP 200. Envelope reported season 2026, week 0, position RB, `scoring: STD`, count 0, and a non-array `players` field. The response also had `public_api_limited` and `tier` keys; their values were not retained by this probe. No usable projected points were returned. |

An empty normalized preview cache records the third probe's reported zero rows.
The parser now accepts explicit empty array/null/object player containers. It
still rejects ambiguous stats arrays, invalid PPR points, duplicate IDs, and
wrong seasons/weeks/positions. A `STD` envelope is not treated as PPR points:
nonempty data must contain the explicit `stats.points_ppr` field.

### Recommended: Offline Rankings Comparison

The supplied `FantasyPros_2026_Draft_ALL_Rankings.csv` contains 543 ranked rows,
plus two blank/tier separators. The importer matches 487 rows to the 674-player
SportsLine workbook. It reports 56 unmatched FantasyPros entries and 187
unmatched SportsLine players. One duplicate identity, Isaiah Williams at WR
(ECR 416 and 455), is retained in the source and flagged, not silently merged.

```bash
npm run fantasypros:compare
# Optional alternative export:
npm run fantasypros:compare -- path/to/rankings.csv
```

This command is entirely offline. It shows FantasyPros ECR/tier beside SportsLine
rating/ADP, with attribution and unmatched-player diagnostics. Set
`FANTASY_PROS_RANKINGS_CSV` to override the default path. Exact identity and unique
full-name suffix variants are supported; ambiguous or nickname matches are not
guessed. This is a full-board comparison, not an available-player list: it does
not remove keepers or drafted players.

The CSV does **not** declare its scoring format. Confirm that the export is PPR
before using it to influence this league's recommendations. `ECR VS. ADP` is a
delta, not numeric ADP. No FantasyPros field overwrites SportsLine ratings, ADP,
player IDs, keeper exclusions, or scoring weights.

### Explicit API Preview

```bash
# Reads the local cache only. Missing/stale caches never trigger a fetch.
npm run fantasypros:preview -- RB

# Spends exactly one request attempt; run only intentionally.
npm run fantasypros:preview -- RB --refresh
```

Refreshes use `FANTASY_PROS_API` server-side, the configured league season, week 0,
and a single selected position. No retries, redirects, pagination, alternate
endpoints, or automatic refreshes occur. A 15-second timeout bounds requests.
Keepers, polling, rendering, recommendations, and tests never invoke this refresh.

Private caches and the attempt ledger live under ignored `.local/fantasypros/`.
The local safety cap is **5 recorded attempts total**, including all three probes;
there is no automatic reset. This is deliberately smaller than the user's
reported 500-query allowance, and does not claim to track calls made elsewhere.
Failures/timeouts count conservatively before the request is sent. Refreshes are
locked across processes and blocked if less than one second apart. A crashed
process may leave a lock: verify that no refresh is running before removing it.
Do not delete/reset the usage ledger to bypass the cap; confirm the actual quota
and choose a new explicit budget before expanding it.

Only allowlisted preview fields are cached; image URLs and historical statistics
are not retained as data. Schema failures can save sanitized field diagnostics
without credentials. Cache timestamps are displayed, not silently refreshed.
All API-client automated tests inject a mock transport and consume zero queries.

### Next Integration Step

The safe current integration is **comparison-only**, not scoring enrichment.
Confirm the CSV's scoring format, resolve material identity mismatches, then add
ECR/tier context to the existing SportsLine-driven shortlist with provenance.
Keep the same keeper and starter-completion gates. Do not convert ECR rank into
projected points or decimal ADP, and do not compute VOR from this empty/sample
projection feed. API refresh scheduling and production use should wait until
entitlements, coverage, and quota terms are clear.

## Executive Findings

- **Confirmed:** The documented base is `https://api.fantasypros.com/public/v2/json`; authentication is the raw API key in the `x-api-key` request header. This is not Bearer authentication or a query-string key. [S1], [S3]
- **Confirmed:** Current marketing describes Free as **all endpoints, sample data, non-production use**, at `$0/mo`. The help article limits free use to personal, non-commercial prototyping/testing. A free key is not documented as providing full, current production draft data. [S1], [S4]
- **Unresolved limit conflict:** The API-specific terms currently linked from the OpenAPI document, dated October 27, 2020, specify **one call per second and up to 100 calls per day**. Current marketing only says "Generous daily call limit." Neither establishes a 500-query plan or its reset mechanics. Do not assume 500/day, 500/month, or 500 lifetime. [S1], [S3], [S5] section 2.
- **Confirmed at the schema level:** NFL preseason PPR ECR, ADP ranking types, and preseason projections are documented. Projection stat schemas explicitly include `points_ppr`, `points_half`, and `points`. Free-key completeness, freshness, and actual response shapes were not tested. [S3]
- **Confirmed restrictions:** Cache to avoid unnecessary polling; keep the key confidential; credit FantasyPros conspicuously for published work based on its data; do not build a competing product/service. The linked terms exclude historical player statistics and player image URLs from the default license and require prompt deletion if received. [S4], [S5] sections 2-4.

## Official Documentation and Authentication

| Item | Confirmed value |
| --- | --- |
| API base | `https://api.fantasypros.com/public/v2/json` |
| Human-readable documentation | `https://api.fantasypros.com/public/v2/docs` |
| OpenAPI document | `https://api.fantasypros.com/public/v2/docs/fantasypros_v2_public.yml` |
| Specification versions | OpenAPI `3.1.1`; API `info.version: '2.0'` |
| Authentication | `x-api-key: <API_KEY>` |
| OpenAPI security scheme | `components.securitySchemes.api_key`: `type: apiKey`, `in: header`, `name: x-api-key` |
| Transport and response format | HTTPS; JSON |
| API-specific terms | `https://api.fantasypros.com/public/v2/terms-of-use` (a PDF despite the extensionless URL) |

Sources: official API overview and the OpenAPI document loaded by the documentation page. [S1], [S2], [S3]

`FANTASY_PROS_API` is this user's local configuration name, not a FantasyPros-defined HTTP field. A future integration would map its value to `x-api-key` on the server only. Never put the value in source control, a URL, browser code, request logs, or a published example. Confidentiality is expressly required by the API terms. [S5] section 2.

## Free Plan, Billing, and Quota

| Question | Evidence and conclusion |
| --- | --- |
| What does Free include? | Marketing says "All endpoints, sample data," full docs/live explorer, and non-production use. Help says personal, non-commercial building/testing/learning/prototyping. Endpoint inclusion does not promise production-quality or complete data. [S1], [S4] |
| What does Free cost? | Advertised as `$0 / mo`. No reviewed source defines per-call overage charges, auto-upgrades, or charge behavior after quota exhaustion. Do not infer a billing guarantee from the advertised price. [S1], [S3], [S5] |
| Is there a published numeric limit? | The API-linked 2020 terms say one call/second and up to 100 calls/day. Current pricing supplies no numeric Free allowance. This is a published contractual statement, not a measurement of the user's current key. [S1], [S5] section 2. |
| What does the user's 500 mean? | Unknown from public sources: original allowance versus remaining calls, daily/monthly/lifetime period, or a key-specific/legacy arrangement. Do not silently substitute either 100 or 500 as the verified effective limit. |
| When does quota reset? | Unknown: calendar versus rolling window, reset time/timezone, monthly billing anchor, rollover, and treatment of unused calls. "Per day" alone does not answer these. [S1], [S5] section 2. |
| What counts as a query? | Unknown: charging for failures, empty responses, retries, redirects, conditional requests/304s, or differing endpoint weights. The terms count "API calls" but provide no metering algorithm. [S5] section 2. |
| Can quota be checked without using quota? | No quota/usage/status endpoint or rate-limit response headers are defined in the reviewed OpenAPI document. Whether an account dashboard shows balance/reset information is unknown; it was not opened. [S3] |
| What happens at the limit? | The terms permit throttling, restriction, or suspension. Exact HTTP status, error schema, `Retry-After` behavior, reset headers, and whether excess calls incur charges are not documented in the reviewed API reference. Do not assume a guaranteed `429` response. [S3], [S5] section 6. |
| What changes with Premium? | An active paid HOF subscription includes personal/non-commercial production access and higher limits. The advertised starting price is `$8.99/mo` on annual billing, not a verified month-to-month price. HOF free trials do not include Premium API access. Numeric Premium limits are not provided here. [S1], [S4] |
| What needs Commercial? | Paid/revenue-generating apps, business/organizational use, redistribution, and high-volume platforms require a separate agreement. Marketing also places historical/bulk access and custom SLAs in Commercial. [S1], [S4] |

**Recommendation:** Obtain written clarification of the 500-query allowance and applicable terms before scheduled fetching or actual draft use. Do not presume that a larger technical allowance overrides the linked license. For now, treat 500 as a scarce user-imposed budget with no assumed replenishment, not as permission to make calls. Even the more conservative published 100/day does not establish that this user's balance resets daily.

### Documented Endpoint Inventory

All paths below are `GET` routes relative to the base URL. These are the endpoints covered by the public OpenAPI document; Free's "all endpoints" claim is explicitly qualified by "sample data." The inventory is not confirmation of this key's access or permission to use every returned field. [S1], [S3], [S5]

| Group | Paths |
| --- | --- |
| Players | `/{sport}/players`, `/{sport}/compare-players` |
| News and injuries | `/{sport}/news`, `/{sport}/injuries` |
| Rankings | `/{sport}/{season}/rankings`, `/{sport}/{season}/consensus-rankings`, `/{sport}/{season}/rankings/experts` |
| Projections | `/nfl/{season}/projections`, `/mlb/{season}/projections`, `/nba/{season}/projections` |
| Scoring and lineups | `/nfl/{season}/player-points`, `/mlb/lineups` |

The marketing-supported sports are NFL, MLB, NBA, and NHL. Shared schema enums contain additional sport identifiers; that alone is not proof of supported datasets for those sports. [S1], [S3]

## NFL Preseason PPR ECR

**Confirmed route:** `GET /nfl/{season}/consensus-rankings`. Its query parameters reference `Position`, `RankingType`, and `Scoring`. The request parameter for ranking type is **`type`**, not `ranking_type`. [S3], path `/{sport}/{season}/consensus-rankings` and `components.parameters`.

| Parameter | Documented facts and intended selection |
| --- | --- |
| `season` | Required path parameter; use the intended NFL season, e.g. `2026`. A valid year does not guarantee data availability. |
| `position` | Required query parameter. NFL enum includes `ALL`, `FLX`, `OP`, `QB`, `RB`, `WR`, `TE`, `K`, `DST`, and IDP positions. `ALL` is the documented all-position candidate for a draft board; do not invent `FLEX` or `DEF`. |
| `type` | NFL enum includes `PRESEASON`, `DRAFT`, `PRE`, `ROS`, `ADP`, `DYNASTY`, and others. Use explicit `PRESEASON` for the intended dataset. The reference does not explain whether `DRAFT`, `PRE`, and `PRESEASON` are interchangeable aliases. |
| `scoring` | NFL enum is `STD`, `PPR`, `HALF`, with `STD` the default. Explicitly set `PPR`. |
| `week` | Integer, minimum 0, example 0. Set `0` alongside `type=PRESEASON`; the consensus route does not itself explain week-zero semantics. The projections route explicitly identifies week 0 as preseason. |
| `filters` | Optional expert-ID filter. Its prose says comma-delimited, but its regex/example use colons. Omit it until clarified. |
| `experts` | Optional `show` or `available` for expert details; omit for a smaller first response. |

Source for the table: [S3], the consensus operation and schemas `NFLPositions`, `NFLRankingTypes`, `NFLScoringTypes`.

**Documented overall draft-board endpoint, used in live test 1:**

```text
https://api.fantasypros.com/public/v2/json/nfl/2026/consensus-rankings?position=ALL&type=PRESEASON&scoring=PPR&week=0
```

### ECR Response Schema

The operation points to `NFLRankingsResponse`, which combines `ConsensusRankings` with NFL-specific fields. Relevant documented fields are: [S3]

| Location | Fields and types |
| --- | --- |
| Envelope | `sport`; `year` and `week` strings; nullable/string `filters`; integer `count` and `total_experts`; string `last_updated`; integer `last_updated_ts`; `players` array |
| NFL envelope | `scoring`, `position_id`, `ranking_type_name` |
| Player identity | Integer `player_id`; strings `player_name`, `player_team_id`, `player_position_id`, `player_positions`, `cbs_player_id`, `player_bye_week`, `player_page_url` |
| Rankings | `rank_ecr` integer or string; string `pos_rank`; integer `tier`; nullable numeric `player_ecr_delta` |

The overview advertises best/worst/std-dev information, but the specific NFL consensus-player schema does not enumerate those fields. The separate `/rankings` operation documents `range=true` and `rankstats=true`, with `rank.ECR_MIN`, `ECR_MAX`, `ECR_AVG`, and `ECR_STD`. Do not assume every advertised metric exists in every response. [S1], [S3] schemas `NFLRankingPlayer`, `PlayerRank`.

**Unknown:** Free sample size, truncation/selection rules, freshness/delay, supported seasons, coverage by position, and whether the requested year/type/scoring are faithfully reflected by sample responses. The consensus operation has no documented `limit`, `page`, or cursor parameter; completeness must not be inferred merely from a successful response. [S1], [S3]

## ADP Availability and Schema

**Confirmed:** The overview explicitly lists ADP in consensus rankings, and `NFLRankingTypes` includes `ADP` (also `DYNADP`, `RKADP`, and `BESTADP`). No dedicated `/adp` route appears in the public specification. [S1], [S3]

**Documentation-derived PPR ADP candidate, not requested:**

```text
https://api.fantasypros.com/public/v2/json/nfl/2026/consensus-rankings?position=ALL&type=ADP&scoring=PPR&week=0
```

There are three documented ADP-related surfaces, with different schema caveats: [S3]

| Surface | Documented fields | Caveat |
| --- | --- | --- |
| `/nfl/{season}/consensus-rankings?type=ADP` | Uses the same `NFLRankingsResponse` / `NFLRankingPlayer` schema as ECR, including `rank_ecr` and `ranking_type_name` | No separate ADP response model or explicitly named decimal average-pick field is defined there. Do not assert that `rank_ecr` is a mean draft pick rather than an ordinal rank. |
| `/nfl/players` | Base player includes `rank_adp`; NFL adds `rank_adp_ppr`, alongside `rank_ecr_ppr` and `rank_ecr_half` | These rank fields reference `ECRRank`, not a dedicated ADP schema. The route has no season selector. It is not a documented historical/preseason snapshot API. |
| `/nfl/{season}/rankings` | `players[].rank.ADP.ALL` is documented as an integer; ECR metrics can be nested by scoring and position, e.g. `rank.ECR.PPR.ALL` | The ADP object has no explicit scoring dimension in the schema. Do not infer it is PPR ADP or a fractional mean pick. |

**Unknown:** Exact ADP provider mix, inclusion of CBS-specific ADP, draft sample counts/date windows, fractional average-pick representation, and free-key completeness. The reference's inclusion of CBS external player IDs is an identity-mapping feature, not proof of CBS ADP availability. [S3]

**Recommendation:** Keep ECR rank, ADP rank, and numeric average draft pick as distinct concepts. Do not fill an application field expecting a decimal mean pick with an undocumented ordinal value.

## Projected Points Availability and Schema

**Confirmed route:** `GET /nfl/{season}/projections`. The operation explicitly says **`week=0` for preseason projections**. `ros` is a boolean, default `false`; `ros=true` requests rest-of-season projections. Required `position` uses the shared position schema; optional `positions` and `players` are colon-delimited filters. Optional `filters` selects experts, with the delimiter inconsistency noted above. [S3], NFL Projections operation.

**Documented preseason RB endpoint, used in live tests 2-3:**

```text
https://api.fantasypros.com/public/v2/json/nfl/2026/projections?position=RB&week=0&ros=false
```

Unlike consensus rankings, this operation **does not document a `scoring` request parameter**. Its response contains all three projected-points variants. For PPR, the relevant documented statistic is **`points_ppr`**, not `points` and not the response's illustrative `scoring: STD`. [S3]

| Location | Documented schema |
| --- | --- |
| Envelope | String `season`, `week`, `count`, `positions`, `scoring`; integer-array `experts`; array `players` |
| Player | String `fpid`, `mflid`, `name`, `position_id`, `team_id`, `filename`; array `stats` |
| Each stat object | `oneOf` QB, RB/WR/TE, DST, or IDP projection schemas |
| Projected points | Numeric `points`, `points_ppr`, `points_half` in the position-specific schemas |
| QB raw stats | Includes `pass_att`, `pass_cmp`, `pass_yds`, `pass_tds`, `pass_ints`, `rush_att`, `rush_yds`, `rush_tds`, `fumbles`, `ret_tds`, `2pt_tds`, and bonus-related fields |
| RB/WR/TE raw stats | Includes `rush_att`, `rush_yds`, `rush_tds`, `rec_rec`, `rec_yds`, `rec_tds`, `fumbles`, `ret_tds`, `2pt_tds`, and bonus-related fields |

Source: [S3], inline projection response and schemas `NFLQBPlayerProjections`, `NFLRBWRTEPlayerProjections`, `NFLDSTPlayerProjections`, `NFLIDPPlayerProjections`.

### Projection Caveats

- **Schema uncertainty:** `stats` is formally an array, not an object. Its element identity/order is not explained; do not assume the first entry is consensus or blindly implement `player.stats.points_ppr`. Validate the actual container in a separately authorized response. [S3]
- **Specification defects:** `NFLKPlayerProjections` exists but is omitted from the operation's `stats.items.oneOf`. The DST required list contains the combined string `points_half def_sack`, while those are separate properties. Some fields declared as strings have unquoted numeric examples. These are reasons not to treat generated schemas as proof of runtime shape. [S3]
- **Scoring compatibility unknown:** The reviewed API reference does not fully define the scoring coefficients behind its point totals, custom CBS settings, or bonus handling. PPR alone does not guarantee league-specific scoring compatibility. Raw stats permit a potential local calculation once their meanings and the league rules are established. [S3]
- **Do not confuse actual and projected points:** `/nfl/{season}/player-points` returns points already accrued, games, averages, and a week-keyed points map. It is not the preseason projection source. Historical player statistics also face the default-license exclusion. [S1], [S3], [S5] section 2.

## Caching, Use, and Attribution

These are provider statements, not a legal opinion or a determination of this user's contract:

| Topic | Confirmed requirement or limitation |
| --- | --- |
| Cache rather than poll | The API terms say to take steps to cache data so the application does not poll unnecessarily. No exact TTL, required refresh cadence, maximum storage duration, or conditional-request support is established in the reviewed sources. [S3], [S5] section 2. |
| Personal/non-commercial license | The default API terms grant a limited, revocable, non-transferable, non-sublicensable license for personal/non-commercial data use. Current Free guidance additionally limits it to non-production use. [S4], [S5] section 2. |
| Production use | Current help reserves personal/non-commercial production access for paid HOF members. Free is for prototyping, not a documented license for an operational draft bot. Whether this exact project qualifies as a competing service/product should be clarified before deployment. [S4], [S5] section 4. |
| Attribution | Published research, analysis, or other work based on or including API data must conspicuously state that it contains/is based on data obtained from FantasyPros. No exact mandatory wording, logo, or link format is specified in these sources. [S4], [S5] section 3. |
| Non-compete | Current help prohibits products/services directly competing with FantasyPros. The API-linked terms are broader: no direct or indirect competition, including competing products/services. Do not assume non-commercial status removes this restriction. [S4], [S5] section 4. |
| Images and historical stats | The default API terms exclude historical player statistics and player image URLs and require prompt deletion of such data if received. Help separately identifies images as Sportradar-licensed, outside the FantasyPros API license. Do not keep these in an otherwise permitted raw-response cache. [S4], [S5] section 2. |
| Redistribution/commercial use | A separate commercial agreement is required for redistribution and business/revenue-generating uses. Attribution alone does not authorize them. [S1], [S4] |
| Termination and retention | Stop using the API/retrieving data on termination. Previously retrieved data may continue to be used personally/non-commercially only if there was no prior breach and the attribution/non-compete conditions continue to be met. This is not an unconditional retention right. [S5] section 7. |
| Reliability | No warranty of accuracy, availability, or fitness; access can be changed, restricted, or discontinued. [S4], [S5] sections 6 and 8. |

**Recommended attribution, not prescribed wording:** "This analysis is based on data obtained from FantasyPros." A source link and retrieval/as-of date would make provenance clearer, but neither is stated here as a mandatory API attribution format.

**Recommended caching design, subject to entitlement confirmation:** Fetch explicitly outside the draft loop; cache only permitted fields privately, keyed by endpoint, season, week/type, scoring, position, and expert selection. Preserve retrieval time and provider `last_updated_ts` where present. Reuse that snapshot for recommendations and tests instead of fetching per pick, player, render, or test run. Do not publish raw responses as repository fixtures. No specific refresh interval is recommended as a provider-approved TTL.

## Original First-Request Proposal

This was the documentation-only proposal before testing. The live tests actually
performed are listed above; the first test used ALL rather than RB. The remaining
quota and production-use questions are still unresolved.

Recommend **one** request for one position, using the official consensus example's `RB`/`PPR` combination plus documented explicit preseason selectors. It avoids optional expert expansion, an exploratory players lookup, and extra ADP/projection calls. [S1], [S3]

```http
GET /public/v2/json/nfl/2026/consensus-rankings?position=RB&type=PRESEASON&scoring=PPR&week=0 HTTP/1.1
Host: api.fantasypros.com
x-api-key: <API_KEY_SUPPLIED_PRIVATELY_AFTER_AUTHORIZATION>
Accept: application/json
```

Exact URL:

```text
https://api.fantasypros.com/public/v2/json/nfl/2026/consensus-rankings?position=RB&type=PRESEASON&scoring=PPR&week=0
```

This is minimal in request count and optional parameters, not a guaranteed one-row response or one billable quota unit. The consensus route documents no row limit. A single RB response will not establish full draft-board coverage, ADP semantics, or projection shape. [S3]

For that future authorized request only:

1. Make a server-side HTTPS GET with no automatic retries, redirect following, pagination, fallback endpoints, or parallel calls. Do not source `.env` in a shared transcript or print/log the key.
2. Record HTTP status and non-secret response headers once; look for actual quota/reset/cache headers without assuming their names or presence. A network timeout still might have consumed quota, so stop rather than retry.
3. Check response year, week, scoring, ranking type, count, freshness, identity fields, and whether data is sample/truncated. Inspect fields before persisting so excluded image URLs/historical statistics are not retained.
4. Stop after that one attempt, including on errors or empty data. Review the permitted response offline. Do not probe ADP, projections, quota exhaustion, or alternate ranking aliases automatically.

The budget debit is unknown until FantasyPros explains its metering. A filtered response is not documented as cheaper than an all-position response. There is no established zero-cost API "ping" to recommend. [S3], [S5]

## Questions for FantasyPros

These can be answered through support without spending API data quota. The OpenAPI contact is `api@fantasypros.com`; the current help article directs commercial inquiries to `support@fantasypros.com`. No support request was sent. Do not include the secret key in a support message. [S3], [S4]

1. Does this free account's 500 mean total allowance or remaining balance, and what is its period, reset timestamp/timezone, and rollover policy? How does it relate to the currently linked 100/day and 1/second terms?
2. What consumes quota, including errors, empty responses, timeouts/retries, conditional requests, and endpoint-specific weights? Is exhaustion a hard stop, and can any overage or automatic charge occur?
3. Is there a non-metered account usage display, and which response headers, if any, expose remaining quota and reset time?
4. What exactly is Free "sample data": fixed examples, a subset of current players, delayed data, or something else? Are 2026 preseason PPR ECR, ADP, and projected points complete enough for testing?
5. Which license permits this personal draft bot's actual use, given the non-production and non-compete restrictions? What cache retention and redistribution conditions apply?
6. For ADP, which field is the numeric mean draft pick, what provider/scoring mix is used, and is CBS-specific ADP available? For projections, what is the runtime `stats` shape and what scoring coefficients underlie `points_ppr`?

## Primary Sources

All successful source retrievals below were unauthenticated public documentation/help/terms requests on September 7, 2026. The OpenAPI YAML is a documentation asset explicitly loaded by the docs page, not an API data response. The PDF terms were downloaded without credentials and read locally; no live explorer actions were executed.

- **S1:** FantasyPros API overview, endpoint reference, pricing, and FAQ. https://www.fantasypros.com/api-data/
- **S2:** FantasyPros v2 Public Documentation. Its HTML identifies the same-origin YAML used by ReDoc. https://api.fantasypros.com/public/v2/docs
- **S3:** Official OpenAPI YAML, including endpoint parameters, response schemas, `securitySchemes`, contact, and `termsOfService` link. https://api.fantasypros.com/public/v2/docs/fantasypros_v2_public.yml
- **S4:** "How do I request access to the FantasyPros API?" Help article displayed update date August 5, 2026. https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API
- **S5:** API-specific Terms of Use, PDF, displayed last-updated date October 27, 2020; still linked by S3 at research time. Most relevant: section 2 (license, exclusions, confidentiality, limits, caching), section 3 (attribution), section 4 (non-compete), sections 6-8 (termination and warranties). https://api.fantasypros.com/public/v2/terms-of-use
- **S6:** General site Terms of Use, also reviewed. Section 6 restricts reuse and section 19 restricts commercial copying. API-specific S5 is the directly relevant source, rather than treating website access as an API license. https://www.fantasypros.com/about/legal/

Discovery used public Help Center searches at `https://support.fantasypros.com/hc/en-us/search?query=API`, `https://support.fantasypros.com/hc/en-us/search?query=API%20limit`, and `https://support.fantasypros.com/hc/en-us/search?query=attribution`. Search snippets were not used instead of the full help article. Initial documentation-discovery attempts at `https://api.fantasypros.com` and `https://www.fantasypros.com/about/api/` returned a 403 and a not-found page respectively; neither was a data-endpoint test or evidence about authentication/quota behavior. The key-request/account pages were not opened.

[S1]: https://www.fantasypros.com/api-data/
[S2]: https://api.fantasypros.com/public/v2/docs
[S3]: https://api.fantasypros.com/public/v2/docs/fantasypros_v2_public.yml
[S4]: https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API
[S5]: https://api.fantasypros.com/public/v2/terms-of-use
[S6]: https://www.fantasypros.com/about/legal/
