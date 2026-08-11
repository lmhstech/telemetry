// Redaction of anything that looks like personal information, applied to every
// crash report on arrival.
//
// WHY THIS EXISTS
//
// The estate's privacy policy says, flatly, that these systems hold no email
// addresses, no legal names and no student ID numbers. Crash reports are the
// single most likely place for that promise to break by accident: a stack
// trace carries whatever was in scope, and an app that renders a teacher's
// gradebook has names in scope. Velri joins names client-side precisely so
// they never reach a server — an unscrubbed error reporter would undo that in
// one `JSON.stringify(state)`.
//
// So reporting apps are told to scrub before they send, and then this runs
// anyway. "The client promised" is not an access control.
//
// This is intentionally aggressive. A redacted token in a stack trace costs a
// developer a little context; a student's name in a database costs the program
// its FERPA posture. When the two conflict, context loses.

const REDACTED = '[redacted]';

// Order matters: the more specific patterns run first, so an email is not
// first mangled into a redacted local-part plus a visible domain.
const PATTERNS = [
  // Email addresses. There are none in this system, so any that appear came
  // from a user typing one in, and are the exact thing we must not store.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],

  // Bearer tokens, JWTs, API keys, session cookies. Not PII, but a crash
  // report is a bad place to durably store a live credential.
  // `eyJ` is base64url for `{"`, so this only fires on an encoded JSON object
  // followed by two more dot-separated segments. The segment lengths are kept
  // low deliberately: a short JWT is still a credential, and nothing in
  // ordinary prose looks like this.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '[jwt]'],
  [/\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '[credential]'],
  [/\b(?:240ai|sk|pk|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{16,}/g, '[credential]'],

  // Anything self-labelled as a secret in a query string or object dump:
  //   ?password=hunter2   "api_key":"…"   token=abc
  [/\b(pass(?:word|wd)?|secret|api[_-]?key|auth|token|session|cookie)\b(\s*[:=]\s*)("?)[^\s,;&"'}]{4,}\3/gi,
    (_m, key, sep) => `${key}${sep}${REDACTED}`],

  // Student ID numbers. SCPS student IDs are long digit runs; so are phone
  // numbers, card numbers and dates of birth written without separators.
  // Six or more consecutive digits is not something a useful crash message
  // needs, and is the shape of every identifier we are forbidden to hold.
  [/\b\d{6,}\b/g, '[number]'],

  // Phone numbers with separators.
  [/\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, '[phone]'],

  // US SSN shape.
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted]'],

  // Absolute filesystem paths that carry a home directory name. `/Users/jsmith`
  // and `C:\Users\jsmith` both leak a real name from a laptop's account.
  [/(\/(?:Users|home)\/)[^/\s"']+/g, '$1[user]'],
  [/([A-Za-z]:\\Users\\)[^\\\s"']+/gi, '$1[user]'],

  // IP addresses. Cloudflare needs them to route; we do not need to keep them.
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]'],
];

/** Redact a single string. Safe on non-strings (returns '' ). */
export function scrubText(value) {
  if (typeof value !== 'string') return '';
  let out = value;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Keys whose *value* is dropped entirely rather than pattern-matched, because
 * the key name alone says the value is something we must not hold. Matched
 * case-insensitively against the whole key.
 */
const FORBIDDEN_KEYS = new Set([
  'name', 'fullname', 'full_name', 'firstname', 'first_name', 'lastname', 'last_name',
  'displayname', 'display_name', 'realname', 'real_name', 'student_name',
  'email', 'mail', 'emailaddress', 'email_address',
  'studentid', 'student_id', 'sid', 'lunchnumber', 'lunch_number',
  'dob', 'birthdate', 'birth_date', 'dateofbirth', 'date_of_birth',
  'phone', 'phonenumber', 'phone_number', 'mobile',
  'address', 'street', 'zip', 'postalcode', 'postal_code',
  'ssn', 'password', 'passwd', 'secret', 'token', 'apikey', 'api_key',
  'authorization', 'cookie', 'session', 'credential', 'privatekey', 'private_key',
]);

const MAX_DEPTH = 6;
const MAX_KEYS = 60;
const MAX_ARRAY = 40;
const MAX_STRING = 2000;

/**
 * Recursively scrub an app-supplied context object.
 *
 * Also bounds it: depth, breadth and string length are all capped, so a
 * reporter that hands us a whole Redux store does not become a row that costs
 * more to store than the crash is worth.
 */
export function scrubValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '[depth limit]';

  const t = typeof value;
  if (t === 'string') return scrubText(value).slice(0, MAX_STRING);
  if (t === 'number') return Number.isFinite(value) ? value : String(value);
  if (t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return '[unsupported]';

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => scrubValue(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }

  if (t === 'object') {
    const out = {};
    let n = 0;
    for (const [key, v] of Object.entries(value)) {
      if (n >= MAX_KEYS) {
        out['[truncated]'] = true;
        break;
      }
      n++;
      const normalised = key.toLowerCase().replace(/[\s-]/g, '_');
      if (FORBIDDEN_KEYS.has(normalised) || FORBIDDEN_KEYS.has(normalised.replace(/_/g, ''))) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubValue(v, depth + 1);
    }
    return out;
  }

  return '[unsupported]';
}

/**
 * Scrub a stack trace.
 *
 * Same text rules, plus a line cap — the top frames are where the bug is, and
 * a 200-frame recursion trace is all one frame repeated.
 */
export function scrubStack(stack, maxLines = 40) {
  if (typeof stack !== 'string') return null;
  const lines = stack.split('\n').slice(0, maxLines);
  const scrubbed = lines.map((l) => scrubText(l).slice(0, 500)).join('\n');
  return scrubbed.trim() || null;
}
