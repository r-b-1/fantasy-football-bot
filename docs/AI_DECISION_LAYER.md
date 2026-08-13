# OpenAI Decision Layer

## 1. Purpose

Use OpenAI for strategic tie-breaking and synthesis, not for raw page control.

The model should answer a constrained question:

> Given these 7 already-validated candidates and this exact draft state, which candidate best fits the configured strategy?

It should not be asked:

> Browse the draft and pick anybody you want.

## 2. API

Use the OpenAI **Responses API** with the official TypeScript SDK.

Use **Structured Outputs** so the result conforms to a Zod/JSON schema.

Current recommended configurable default:

- model: `gpt-5.6`
- reasoning effort: `low` for live draft latency
- timeout: approximately 5–8 seconds (configurable)

For offline analysis/mocks, higher reasoning can be used.

## 3. Decision schema

Suggested schema:

```ts
const DraftDecisionSchema = z.object({
  selectedCandidateId: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(600),
  alternativeCandidateIds: z.array(z.string()).max(4),
  riskFlags: z.array(z.enum([
    "NONE",
    "POSITION_RUN",
    "TIER_CLIFF",
    "ROSTER_IMBALANCE",
    "BYE_OVERLAP",
    "LOW_CONFIDENCE",
    "STALE_DATA"
  ]))
});
```

After parsing, enforce:

```text
selectedCandidateId must be in candidateIds
all alternativeCandidateIds must be in candidateIds
```

If not, reject the response.

## 4. Prompt design

The system/developer prompt should encode stable rules:

- Full PPR.
- 16 teams.
- 3 starting WRs.
- Keepers already on roster.
- Prefer meaningful RB/WR value early.
- Account for QB scarcity in a 16-team league without blindly reaching.
- Use TE tier cliffs.
- K/DST late.
- SportsLine rating is a trusted model input, not an absolute command.
- ADP is market information; keeper removal distorts direct live-draft equivalence.
- Do not select outside the supplied list.

The user content sent on each pick should be JSON-like structured state, not a giant prose transcript.

## 5. Example model input

```json
{
  "currentOverallPick": 30,
  "nextUserPick": 35,
  "roster": {
    "QB": [],
    "RB": ["Ashton Jeanty"],
    "WR": ["George Pickens", "Player X"],
    "TE": []
  },
  "recentPositionCounts": {"RB": 4, "WR": 6, "QB": 1, "TE": 0},
  "candidates": [
    {
      "id": "...",
      "name": "...",
      "position": "WR",
      "sportslineRating": 68,
      "adp": 41.0,
      "deterministicScore": 90.1,
      "componentScores": {...}
    }
  ]
}
```

## 6. Fallback rules

If model call:

- times out,
- errors,
- refuses,
- returns invalid structured output,
- chooses outside shortlist,
- confidence is below configured threshold,

then use deterministic candidate #1.

AI failure should never cause a random pick.

## 7. Why not use Computer Use as the normal executor

OpenAI supports computer-use harnesses, including with Playwright, but the official guidance emphasizes isolation, allowlists, and human involvement for authenticated/high-impact actions.

For this project, the AI does not need to interpret the browser to make the football decision. Playwright can extract reliable structured state, which is easier to validate and less vulnerable to prompt injection or visual ambiguity.

Computer use can still be helpful during development when diagnosing an unfamiliar CBS UI state.

## 8. Security

- `OPENAI_API_KEY` lives in `.env` only.
- `.env` is gitignored.
- Never expose the key to browser page JavaScript.
- All model requests originate from the local Node process.
- Do not send CBS cookies/session tokens to OpenAI.
- Do not send raw HTML unless absolutely necessary.
- Strip unrelated chat/page text from model context.
