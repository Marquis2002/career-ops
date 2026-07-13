# Mode: upskill -- Skill-Gap Learning Plan

## Purpose

Turn career-ops tracker data, reports, saved JDs, and an optional target role
into a practical learning plan. The goal is to close recurring skill gaps for
roles the user actually wants, not to generate generic course lists.

## Source-of-Truth Boundary

For candidate facts, read only:

- `cv.md`
- `article-digest.md`
- `config/profile.yml`
- `modes/_profile.md`
- `voice-dna.md` for tone only
- `writing-samples/` for tone only
- `interview-prep/story-bank.md`
- `interview-prep/{company}-{role}.md`
- factual statements the user makes in the current conversation

Never use `ai-job-search` profile files, placeholders, sibling repos, or memory
as candidate facts. If a skill is not evidenced in the files above, mark it as a
gap or ask the user; do not infer it.

## Inputs

Aggregate mode (`/career-ops upskill`):

- `data/applications.md`
- `reports/*.md`
- `jds/*`
- the source-of-truth files listed above

Targeted mode (`/career-ops upskill <url|report-slug|local:jds/file>`):

- A live job URL, a report slug or number from `reports/`, or a saved JD path
- the source-of-truth files listed above

## Output

Write the learning plan under `interview-prep/`:

- Aggregate: `interview-prep/upskill-{YYYY-MM-DD}.md`
- Targeted: `interview-prep/upskill-{YYYY-MM-DD}-{slug}.md`

This is user-layer work product. Do not write user-specific findings into
`modes/_shared.md` or other system-layer files.

## Step 0 -- Setup Check

Before generating a plan, confirm the basics exist:

- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`

If any are missing, stop and guide onboarding. A learning plan without profile
facts will be noisy.

## Step 1 -- Resolve Scope

If the user passed a target:

- URL: fetch/read the JD and keep the original URL in the plan.
- Report slug or number: find the matching file in `reports/`.
- `local:jds/file` or `jds/file`: read the saved JD.

If no target was passed:

- Read `data/applications.md` if present.
- Read recent reports and saved JDs.
- Prefer repeated gaps from high-fit or repeatedly evaluated roles.
- Ignore jobs the user marked `SKIP` unless the notes say the gap is relevant to
  future targeting.

If there are no tracker rows, reports, or saved JDs, tell the user to evaluate or
save a few roles first.

## Step 2 -- Extract Demand Signals

For each role/JD/report, extract:

- role title and company
- must-have skills
- preferred skills
- domain knowledge
- seniority signals
- tools/platforms/frameworks
- repeated wording worth mirroring later

Normalize synonyms conservatively. Example: "LLM evaluation" may cover eval
harnesses, golden datasets, and regression testing, but do not treat it as deep
MLOps experience unless the profile evidence supports that.

## Step 3 -- Compare Against Profile Evidence

For every demand signal, classify the user's current evidence:

| Coverage | Meaning |
|----------|---------|
| Strong | Clearly evidenced in source-of-truth files |
| Partial | Related evidence exists, but the JD asks for a sharper version |
| Missing | No in-scope evidence |
| Unknown | The user may have it, but it is not documented |

Use a gap priority:

| Priority | Meaning |
|----------|---------|
| Critical | Repeated must-have gap or blocks a target role |
| High | Common preferred gap that materially improves fit |
| Medium | Useful differentiator or interview-risk area |
| Low | Nice-to-have; do not plan unless the user asks |

## Step 4 -- Build The Plan

For Critical and High gaps, create an actionable plan with:

- outcome the user should be able to demonstrate
- 1-3 concrete learning resources
- portfolio or interview artifact
- timebox in hours or weeks
- proof to add later to `article-digest.md` or `interview-prep/story-bank.md`
  only after the user actually completes it

If there are fewer than five Critical/High gaps, include Medium gaps until the
plan has useful coverage.

When recommending resources, browse for current official docs, current course
pages, or active project repositories. Include exact access dates in the plan.
Do not invent URLs, prices, availability, course freshness, or certification
status.

## Step 5 -- Report Structure

Write:

```markdown
# Skill-Gap Learning Plan -- {YYYY-MM-DD}

**Scope:** {aggregate | target}
**Inputs:** {tracker/report/JD list}
**Generated:** {YYYY-MM-DD}

## Executive Summary

One paragraph with the top 2-3 gaps and the suggested order.

## Gap Heatmap

| Priority | Skill / Area | Demand Signal | Profile Coverage | Evidence | Next Action |
|----------|--------------|---------------|------------------|----------|-------------|

## Learning Plan

### 1. {Gap Name}

**Why it matters:** ...
**Target outcome:** ...
**Timebox:** ...
**Resources checked on {date}:**
- ...
**Artifact to produce:** ...
**Interview proof to capture:** ...

## Interview Prep Hooks

List STAR prompts the user should answer, without fabricating stories.

## What Not To Learn Yet

Low-priority or distracting skills, with short rationale.
```

## STAR Guidance

Only add STAR prompts, not completed stories, unless the user supplies real
details. A good prompt asks for:

- Situation: company/team/project context
- Task: what the user owned
- Action: specific decisions and trade-offs
- Result: measurable or observable outcome
- Reflection: what changed in later work

If the user supplies real stories during the session, save them to
`interview-prep/story-bank.md`. Never copy placeholder STAR examples from any
other project.

## Final Response

After writing the plan, tell the user:

- the file path
- the top three skills to work on first
- the first artifact to build or story to capture
