// Workers AI issue triage.
//
// The job: given a new issue, decide whether it is the thing to fix now or the
// thing to fix in June. A class of thirty has one teacher, and a wall of
// undifferentiated red is the same as no alerting at all.
//
// The shape of the decision, and the reason it is not just "ask the model":
//
//   1. Deterministic rules compute a FLOOR. Anything touching sign-in, data
//      loss or privacy is at least P2 regardless of what any model thinks.
//      Rules are also the only thing that runs when Workers AI is down.
//   2. The model then classifies within what is left. It is good at reading a
//      stack trace and saying "this is a null check someone forgot" versus
//      "the database is gone", which is exactly the judgement a rule cannot
//      make.
//   3. The floor is re-applied to the model's answer. The model may raise
//      priority; it may not lower it past the floor.
//
// The model never decides who can see an issue, how long it is kept, or
// anything about a student. It sorts a work queue.

import { parseJson } from './http.js';

const DEFAULT_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/openai/gpt-oss-20b',
  '@cf/meta/llama-3.1-8b-instruct-fp8',
];

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

const RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

/** The more severe of two priorities (P1 beats P4). */
function moreSevere(a, b) {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] <= RANK[b] ? a : b;
}

function models(env) {
  const configured = String(env.AI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_MODELS;
}

// ── Deterministic floor ────────────────────────────────────────────────────

// Signals that a failure is in the part of the estate where being wrong is
// expensive. Matched against the title, culprit and top of the stack.
const CRITICAL_SIGNALS = [
  /\b(?:oidc|jwks|jwt|id[_ ]?token|token exchange|nonce mismatch|state mismatch)\b/i,
  /\b(?:auth|login|sign[- ]?in|session|unauthori[sz]ed|forbidden)\b/i,
  /\b(?:d1|database|sqlite|no such table|constraint failed|disk i\/o)\b/i,
  /\b(?:data loss|corrupt|integrity|migration failed)\b/i,
];

const PRIVACY_SIGNALS = [
  /\b(?:pii|ferpa|privacy|personal (?:data|information))\b/i,
  /\[(?:email|phone|number)\]/, // the scrubber caught something it should not have seen
];

// Signals that a failure is cosmetic or environmental — the noise floor.
const LOW_SIGNALS = [
  /\b(?:favicon|source ?map|\.map\b|ResizeObserver loop|Non-Error promise rejection)\b/i,
  /\b(?:abort(?:ed|error)|network ?error|failed to fetch|load failed)\b/i,
  /\b(?:extension|chrome-extension|moz-extension|safari-extension)\b/i,
];

/**
 * Priority floor from rules alone. Also used verbatim when AI is unavailable,
 * which is why it returns a rationale a human can read.
 */
export function ruleFloor(issue) {
  const haystack = [issue.title, issue.culprit, issue.sample_stack].filter(Boolean).join('\n').slice(0, 4000);

  if (PRIVACY_SIGNALS.some((r) => r.test(haystack))) {
    return { priority: 'P1', reason: 'Touches personal data or the privacy scrubber fired — always looked at first.' };
  }
  if (CRITICAL_SIGNALS.some((r) => r.test(haystack))) {
    return { priority: 'P2', reason: 'Involves sign-in, sessions or the database, where a failure blocks a whole class.' };
  }
  if (issue.level === 'info') {
    return { priority: 'P4', reason: 'Informational report.' };
  }
  return { priority: null, reason: null };
}

/**
 * Volume is evidence, not a verdict. Something happening to everyone in a
 * period matters more than the same thing happening once, but a tight crash
 * loop in one kiosk can manufacture a big number on its own — so this only
 * ever nudges by one step, and never past P2.
 */
export function volumeAdjust(priority, eventsCount) {
  if (!priority || priority === 'P1' || priority === 'P2') return priority;
  if (eventsCount >= 50) return 'P2';
  if (eventsCount >= 10 && priority === 'P4') return 'P3';
  return priority;
}

// ── Model pass ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You triage error reports for a high-school computer-science classroom's web apps.
You are sorting a work queue for a teacher and a few student developers.

Assign exactly one priority:
P1 - Users cannot work. Sign-in broken, data lost or corrupted, an app fully down, or anything exposing personal information.
P2 - A core feature is broken for many users, or there is a security-relevant failure. Work continues but badly.
P3 - A real bug with a workaround, or affecting a few users or one screen.
P4 - Noise. Cosmetic, third-party, browser-extension, cancelled network requests, or an error that harms nothing.

Judge the actual impact on a student trying to do classwork. A loud stack trace
that changes nothing is P4. A quiet failure that silently drops a submission is P1.

Reply with ONLY a JSON object, no prose and no code fence:
{"priority":"P1|P2|P3|P4","confidence":0.0-1.0,"rationale":"one sentence, max 200 chars, plain language"}`;

function responseText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.response === 'string') return result.response;
  const choice = result.choices && result.choices[0];
  if (choice) return choice.message?.content ?? choice.text ?? '';
  return '';
}

// Instruction-tuned models wrap JSON in prose or fences no matter how firmly
// the prompt says not to. Take the outermost balanced braces rather than fight
// it. Same approach as websites/src/lib/ai.js.
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const direct = parseJson(text.trim());
  if (direct && typeof direct === 'object') return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = parseJson(fenced[1].trim());
    if (parsed && typeof parsed === 'object') return parsed;
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = parseJson(text.slice(start, end + 1));
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

function userPrompt(issue) {
  return [
    `App: ${issue.app_slug || 'unknown'}`,
    `Level: ${issue.level}`,
    `Title: ${issue.title}`,
    issue.culprit ? `Location: ${issue.culprit}` : null,
    `Occurrences: ${issue.events_count}`,
    issue.environment ? `Environment: ${issue.environment}` : null,
    '',
    'Stack (already redacted):',
    (issue.sample_stack || '(none supplied)').slice(0, 2000),
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Triage one issue.
 *
 * Never throws and never returns null: if every model fails, the rule floor is
 * the answer. An issue that cannot be triaged must still land on the board —
 * silently dropping the thing you could not classify is the worst outcome
 * available.
 */
export async function triageIssue(env, issue) {
  const floor = ruleFloor(issue);

  const isNoise = LOW_SIGNALS.some((r) => r.test(`${issue.title}\n${issue.culprit || ''}`));
  if (!floor.priority && isNoise) {
    return {
      priority: volumeAdjust('P4', issue.events_count),
      source: 'rule',
      aiPriority: null,
      confidence: null,
      rationale: 'Recognised as a known-noisy error class (third-party, cancelled request, or cosmetic).',
      model: null,
    };
  }

  for (const model of models(env)) {
    try {
      const result = await env.AI.run(model, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(issue) },
        ],
        max_tokens: 300,
        temperature: 0.1,
      });

      const parsed = extractJson(responseText(result));
      const aiPriority = PRIORITIES.includes(parsed?.priority) ? parsed.priority : null;
      if (!aiPriority) {
        console.warn(`triage: model ${model} returned no usable priority; trying next`);
        continue;
      }

      // The model may raise severity; the floor is the most it may relax to.
      const settled = volumeAdjust(moreSevere(aiPriority, floor.priority), issue.events_count);

      let confidence = Number(parsed.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) confidence = null;

      let rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim().slice(0, 240) : '';
      if (settled !== aiPriority && floor.reason) {
        rationale = `${rationale} (Raised to ${settled}: ${floor.reason})`.trim().slice(0, 400);
      }

      return {
        priority: settled,
        source: 'ai',
        aiPriority,
        confidence,
        rationale: rationale || 'No rationale supplied.',
        model,
      };
    } catch (err) {
      console.warn(`triage: model ${model} failed: ${err && err.message}`);
    }
  }

  // Every model failed. Fall back to rules, and say so on the card rather than
  // presenting a guess as a judgement.
  const fallback = volumeAdjust(floor.priority || 'P3', issue.events_count);
  console.error('triage: all AI models failed; using rule floor');
  return {
    priority: fallback,
    source: 'rule',
    aiPriority: null,
    confidence: null,
    rationale: floor.reason
      ? `${floor.reason} (AI triage unavailable.)`
      : 'AI triage unavailable — filed at default priority for a human to sort.',
    model: null,
  };
}
