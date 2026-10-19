import type { Change, JobSummary, PageResult } from '@regressionbot/sdk';

// postOrUpdateComment finds the comment to update by this heading, so it must not change.
export const COMMENT_HEADING = '### 🚀 RegressionBot Visual Test Results';
export const FAILURE_HEADING = '### ⚠️ RegressionBot Visual Check Failed';

export const APP_URL = 'https://regressionbot.com';

// GitHub rejects a comment body over 65,536 characters. Leave room for the closing lines.
export const MAX_COMMENT_LENGTH = 65536;
const BUDGET = MAX_COMMENT_LENGTH - 1000;

const LINE_LIMIT = 90;
const PAGES_PER_GROUP = 4;
const LINES_PER_PAGE = 2;
const SHARED_PER_GROUP = 3;
const ERRORS_SHOWN = 5;

type Group = NonNullable<PageResult['changeGroup']>;

const GROUP_ORDER: Group[] = ['structural', 'edited', 'metadata', 'cosmetic', 'date', 'unmeasured'];

// What the pages in each group did, as a predicate for "N pages …" and "All N changed pages …".
const GROUP_PHRASE: Record<Group, (n: number) => string> = {
  structural: () => 'gained or lost content',
  edited: n => `edited ${n === 1 ? 'its' : 'their'} wording`,
  metadata: () => 'changed only in metadata',
  cosmetic: () => 'changed only in appearance',
  date: () => 'changed only a date',
  unmeasured: () => 'changed visually, with no text diff',
};

// Knock-on effects of an edit elsewhere on the page. Shown only when a page has nothing else.
const CONSEQUENCE_TYPES = new Set(['move', 'sticky-reposition', 'reflow-displacement']);

interface Line {
  key: string;
  text: string;
}

interface Page {
  result: PageResult;
  label: string;
  lines: Line[];
}

function pages(n: number): string {
  return `${n} page${n === 1 ? '' : 's'}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function more(n: number, word: string): string {
  return `${n} more ${word}${n === 1 ? '' : 's'}`;
}

function urlPath(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.pathname + u.search;
  } catch {
    return urlStr;
  }
}

/** Clip at a word boundary so a line never ends mid-word. */
export function clip(text: string, limit = LINE_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

/**
 * Page text is untrusted: keep it from forming links, mentions, HTML or markdown. Whole URLs
 * are shortened to their path, which is the part a reviewer needs.
 */
function plain(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>)…]+/g, m => urlPath(m))
    .replace(/[\\`*_[\]<>|~#]/g, c => `\\${c}`)
    .replace(/@(?=\w)/g, '@​');
}

function quote(text: string | undefined, limit: number): string {
  return `“${plain(clip(text ?? '', limit))}”`;
}

/** Prose that quotes a JSON response reads as `{…}`: the fragment itself says nothing. */
function prose(text: string): string {
  let out = text;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/[{[](?:[^{}[\]]|\{…\}|\[…\])*[}\]]/g, m =>
      /["…]/.test(m) ? (m[0] === '{' ? '{…}' : '[…]') : m
    );
  }
  return out;
}

// Where a quote may start or stop without cutting a word: spaces and JSON punctuation.
const BOUNDARY = /[\s,;:{}[\]()]/;
const CONTEXT = 12;

/**
 * Drop what both sides share so the quote lands on what changed, the way the API clips a
 * long passage: “…"PROCESSING","items"…” → “…"PROCESSING","estimatedDelivery":"2026-11-02"…”.
 */
function edit(before: string, after: string, limit: number): string {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) end++;

  let from = 0;
  if (start > CONTEXT * 2) {
    from = start - CONTEXT;
    while (from > 0 && !BOUNDARY.test(before[from - 1])) from--;
  }
  const side = (s: string) => {
    let to = s.length;
    if (end > CONTEXT * 2) {
      to = s.length - end + CONTEXT;
      while (to < s.length && !BOUNDARY.test(s[to])) to++;
    }
    return `${from ? '…' : ''}${s.slice(from, to).trim()}${to < s.length ? '…' : ''}`;
  };
  return `${quote(side(before), limit)} → ${quote(side(after), limit)}`;
}

/** For an href, only the part that differs: the query values, or else the path. */
function hrefDelta(from: string, to: string): string {
  try {
    const a = new URL(from, 'https://x.invalid');
    const b = new URL(to, 'https://x.invalid');
    if (a.origin === b.origin && a.pathname === b.pathname) {
      const keys = new Set([...a.searchParams.keys(), ...b.searchParams.keys()]);
      const diffs: string[] = [];
      for (const k of keys) {
        const va = a.searchParams.get(k);
        const vb = b.searchParams.get(k);
        if (va !== vb) diffs.push(`${k}=${va ?? '∅'} → ${k}=${vb ?? '∅'}`);
      }
      if (a.hash !== b.hash) diffs.push(`${a.hash || '∅'} → ${b.hash || '∅'}`);
      if (diffs.length) return plain(clip(diffs.join(', '), 60));
    }
    const host = (u: URL) => (u.hostname === 'x.invalid' ? '' : u.hostname);
    return `${plain(clip(host(a) + a.pathname, 40))} → ${plain(clip(host(b) + b.pathname, 40))}`;
  } catch {
    return `${quote(from, 35)} → ${quote(to, 35)}`;
  }
}

function named(c: Change, fallback: string): string {
  return c.label ? `${fallback} ${quote(c.label, 30)}` : fallback;
}

/** One reader-facing line for a measured edit, in the digest email's voice. */
export function describeChange(c: Change): string {
  const both = c.before !== undefined && c.after !== undefined;
  switch (c.type) {
    case 'text-edit':
    case 'move-with-edit':
      return edit(c.before ?? '', c.after ?? '', 40);
    case 'insert':
      return c.after ? `added ${quote(c.after, 75)}` : `added a ${plain(c.element)} element`;
    case 'delete':
      return c.before ? `removed ${quote(c.before, 75)}` : `removed a ${plain(c.element)} element`;
    case 'attribute-edit': {
      const parts = Object.entries(c.attributes ?? {}).map(([name, [from, to]]) =>
        name === 'href' ? `link ${hrefDelta(from, to)}` : `${plain(name)} ${quote(from, 25)} → ${quote(to, 25)}`
      );
      const what = c.label ? `${quote(c.label, 25)}: ` : '';
      return what + (parts.join('; ') || `${plain(c.element)} attributes changed`);
    }
    case 'style-only': {
      const props = Object.entries(c.style ?? {})
        .slice(0, 2)
        .map(([prop, [from, to]]) => `${plain(prop)} ${plain(clip(from, 20))} → ${plain(clip(to, 20))}`);
      return `${named(c, plain(c.element))} restyled${props.length ? `: ${props.join(', ')}` : ''}`;
    }
    case 'image-change':
      return `${named(c, 'image')} changed`;
    case 'font-failed':
      return `font failed to load${c.label ? ` (${plain(clip(c.label, 30))})` : ''}`;
    case 'meta-edit':
    case 'schema-edit':
      return both
        ? `${plain(c.element)}: ${quote(c.before, 32)} → ${quote(c.after, 32)}`
        : `${plain(c.element)} changed`;
    case 'meta-insert':
    case 'schema-insert':
      return `added ${plain(c.element)}${c.after ? ` ${quote(c.after, 50)}` : ''}`;
    case 'meta-delete':
    case 'schema-delete':
      return `removed ${plain(c.element)}${c.before ? ` ${quote(c.before, 50)}` : ''}`;
    case 'move':
    case 'sticky-reposition':
    case 'reflow-displacement':
      return 'layout shifted';
    default:
      return both ? `${quote(c.before, 38)} → ${quote(c.after, 38)}` : `${plain(c.element)} changed`;
  }
}

function changeKey(c: Change): string {
  return JSON.stringify([c.type, c.element, c.before ?? null, c.after ?? null, c.attributes ?? null, c.style ?? null]);
}

function summaryItems(r: PageResult): { label: string; text: string }[] {
  const s: unknown = r.regressionbotSummary;
  if (Array.isArray(s)) return s.filter(i => i && i.text).map(i => ({ label: i.label || '', text: String(i.text) }));
  if (typeof s === 'string') return s.split('\n').filter(l => l.trim()).map(text => ({ label: '', text }));
  return [];
}

/** A page's lines for grouping: its measured edits, or failing that its summary sentences. */
function pageLines(r: PageResult): Line[] {
  const changes = r.changes ?? [];
  const edits = changes.filter(c => !CONSEQUENCE_TYPES.has(c.type));
  const chosen = edits.length ? edits : changes.slice(0, 1);
  const lines: Line[] = chosen.map(c => ({ key: changeKey(c), text: describeChange(c) }));
  if (!lines.length) {
    for (const item of summaryItems(r)) {
      lines.push({ key: `summary:${item.text.trim()}`, text: plain(clip(prose(item.text))) });
    }
  }
  const seen = new Set<string>();
  return lines.filter(l => !seen.has(l.key) && !!seen.add(l.key));
}

/** The group a page belongs to; derived from its edits when the API predates changeGroup. */
function groupOf(r: PageResult): Group {
  if (r.changeGroup && GROUP_ORDER.includes(r.changeGroup)) return r.changeGroup;
  const types = new Set((r.changes ?? []).map(c => c.type));
  const has = (...t: string[]) => t.some(x => types.has(x as Change['type']));
  if (has('insert', 'delete', 'image-change')) return 'structural';
  if (has('text-edit', 'move-with-edit', 'attribute-edit')) return 'edited';
  if (has('meta-edit', 'meta-insert', 'meta-delete', 'schema-edit', 'schema-insert', 'schema-delete')) return 'metadata';
  if (types.size) return 'cosmetic';
  return 'unmeasured';
}

/** Edits on at least three pages and at least half of them, most common first. */
function sharedEdits(members: Page[]): [string, { text: string; count: number }][] {
  const counts = new Map<string, { text: string; count: number }>();
  for (const p of members) {
    for (const l of p.lines) {
      const entry = counts.get(l.key) ?? { text: l.text, count: 0 };
      entry.count++;
      counts.set(l.key, entry);
    }
  }
  return [...counts.entries()]
    .filter(([, e]) => e.count >= 3 && e.count * 2 >= members.length)
    .sort((a, b) => b[1].count - a[1].count);
}

function renderGroup(group: Group, members: Page[]): string[] {
  const n = members.length;
  const out = [`**${pages(n)} ${GROUP_PHRASE[group](n)}**`];

  const shared = sharedEdits(members).slice(0, SHARED_PER_GROUP);
  const sharedKeys = new Set(shared.map(([k]) => k));
  for (const [, e] of shared) out.push(`- On ${e.count} of ${n} pages: ${e.text}`);

  // With a shared edit, a page that has nothing else is already described by it.
  const own = members.map(p => ({ page: p, lines: p.lines.filter(l => !sharedKeys.has(l.key)) }));
  const listed = shared.length ? own.filter(o => o.lines.length) : own;
  for (const { page, lines } of listed.slice(0, PAGES_PER_GROUP)) {
    out.push(`- ${page.label}`);
    for (const l of lines.slice(0, LINES_PER_PAGE)) out.push(`  - ${l.text}`);
    if (lines.length > LINES_PER_PAGE) out.push(`  - and ${lines.length - LINES_PER_PAGE} more`);
  }
  if (listed.length > PAGES_PER_GROUP) out.push(`- and ${more(listed.length - PAGES_PER_GROUP, 'page')}`);
  return out;
}

type Decision = 'bug' | 'needs_review' | 'intentional' | 'noise';

const DECISION_TAG: Record<Decision, string> = {
  bug: 'looks like a bug',
  needs_review: 'needs review',
  intentional: 'intended',
  noise: 'noise',
};

const BUGS_SHOWN = 10;
const REVIEWS_SHOWN = 5;
const INTENTS_SHOWN = 3;

// A changed page the judge never reached is one a person has to look at.
function decisionOf(r: PageResult): Decision {
  return r.verdict?.decision ?? 'needs_review';
}

function why(r: PageResult): string {
  const reasoning = r.verdict?.reasoning?.trim();
  return reasoning ? `Why: ${plain(clip(prose(reasoning), 140))}` : r.verdict ? '' : 'Not judged on this run';
}

/** Pages that need a person, each with its own edits and the reason it was flagged. */
function renderFlagged(heading: string, members: Page[], shared: Set<string>, shown: number): string[] {
  const out = [`**${heading}**`];
  for (const p of members.slice(0, shown)) {
    out.push(`- ${p.label}`);
    const own = p.lines.filter(l => !shared.has(l.key));
    for (const l of (own.length ? own : p.lines).slice(0, LINES_PER_PAGE)) out.push(`  - ${l.text}`);
    const reason = why(p.result);
    if (reason) out.push(`  - ${reason}`);
  }
  if (members.length > shown) out.push(`- and ${more(members.length - shown, 'page')}`);
  return out;
}

/** Intended pages fold into one line per piece of intent that covers them. */
function renderIntended(members: Page[], against: string): string[] {
  const out = [`**${pages(members.length)} ${members.length === 1 ? 'matches' : 'match'} ${against}**`];
  const byCover = new Map<string, number>();
  for (const p of members) {
    const cover = p.result.verdict?.coveredBy?.trim() ?? '';
    byCover.set(cover, (byCover.get(cover) ?? 0) + 1);
  }
  const quoted = [...byCover.entries()].filter(([c]) => c).sort((a, b) => b[1] - a[1]);
  if (quoted.length === 1 && quoted[0][1] === members.length) return [`${out[0].slice(0, -2)}:** ${quote(quoted[0][0], 80)}`];
  for (const [cover, n] of quoted.slice(0, INTENTS_SHOWN)) out.push(`- ${pages(n)}: ${quote(cover, 80)}`);
  const rest = members.length - quoted.slice(0, INTENTS_SHOWN).reduce((sum, [, n]) => sum + n, 0);
  if (rest && rest < members.length) out.push(`- ${rest} other${rest === 1 ? '' : 's'}`);
  return out;
}

function renderNoise(members: Page[]): string[] {
  const names = members.slice(0, 3).map(p => p.label);
  if (members.length > 3) names.push(more(members.length - 3, 'page').replace(/^(\d+) more/, 'and $1 more'));
  return [`**${pages(members.length)} ${members.length === 1 ? 'looks' : 'look'} like noise:** ${names.join(', ')}`];
}

/** The folded per-page record: every edit, the RegressionBot summary, and the diff link. */
function renderPageDetail(p: Page): string {
  const r = p.result;
  const verdict = r.verdict ? ` · ${DECISION_TAG[decisionOf(r)]}` : '';
  const head = `- ${p.label}${verdict}${r.diffUrl ? ` · [diff](${r.diffUrl})` : ''}`;
  const lines = (r.changes ?? []).map(c => `  - ${describeChange(c)}`);
  if (r.verdict?.reasoning) lines.push(`  - ${why(r)}`);
  for (const item of summaryItems(r)) {
    lines.push(`  - ${item.label ? `${plain(item.label)}: ` : ''}${plain(clip(prose(item.text)))}`);
  }
  return [head, ...lines].join('\n');
}

export function renderComment(jobId: string, summary: JobSummary, appUrl: string = APP_URL): string {
  const regressions = summary.regressions ?? [];
  const errors = summary.errors ?? [];
  const newBaselines = summary.newBaselines ?? [];
  const reviewUrl = `${appUrl}/admin/jobs?id=${encodeURIComponent(jobId)}`;

  if (!regressions.length && !errors.length) {
    const baselines = newBaselines.length ? ` · ${plural(newBaselines.length, 'new baseline')}` : '';
    return `${COMMENT_HEADING}\n\nNo pages changed (${summary.totalUrls} checked)${baselines}\n`;
  }

  // Name the device only when the run covered more than one, or every label repeats it.
  const multiVariant = new Set([...regressions, ...errors].map(r => r.variantName)).size > 1;
  const label = (r: { url: string; variantName: string }) =>
    `\`${urlPath(r.url).replace(/`/g, '')}\`${multiVariant ? ` (${plain(r.variantName)})` : ''}`;

  const all: Page[] = regressions.map(r => ({ result: r, label: label(r), lines: pageLines(r) }));
  const groups = new Map<Group, Page[]>();
  for (const p of all) {
    const g = groupOf(p.result);
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const ordered = GROUP_ORDER.filter(g => groups.has(g)).map(g => [g, groups.get(g)!] as const);

  // Verdicts lead when the run carried an intent and the judge reached the pages.
  const intent = summary.intentAssessment;
  const judged = !!intent?.intentProvided && regressions.some(r => r.verdict);
  const byDecision = (d: Decision) => all.filter(p => decisionOf(p.result) === d);
  const bugs = judged ? byDecision('bug') : [];
  const reviews = judged ? byDecision('needs_review') : [];

  const counts = [
    regressions.length ? `${pages(regressions.length)} changed` : '',
    bugs.length ? `${bugs.length} ${bugs.length === 1 ? 'looks like a bug' : 'look like bugs'}` : '',
    reviews.length ? `${reviews.length} need${reviews.length === 1 ? 's' : ''} review` : '',
    errors.length ? plural(errors.length, 'error') : '',
    newBaselines.length ? plural(newBaselines.length, 'new baseline') : '',
  ].filter(Boolean);
  const main = [COMMENT_HEADING, '', `**${counts.join(' · ')}** · [Review the run →](${reviewUrl})`];

  const runSummary = summary.runSummary?.trim() || (judged ? intent.summary?.trim() : '');
  if (runSummary) {
    main.push('', plain(runSummary));
  } else if (ordered.length) {
    const [g, members] = [...ordered].sort((a, b) => b[1].length - a[1].length)[0];
    main.push(
      '',
      members.length === regressions.length
        ? `${members.length === 1 ? 'The changed page' : `All ${members.length} changed pages`} ${GROUP_PHRASE[g](members.length)}.`
        : `Most of the changes: ${pages(members.length)} ${GROUP_PHRASE[g](members.length)}.`
    );
  }

  if (judged) {
    const shared = new Set(sharedEdits(all).map(([k]) => k));
    const intended = byDecision('intentional');
    const noise = byDecision('noise');
    const against = summary.runContext?.prTitle ? 'the PR' : 'the stated intent';
    if (bugs.length) main.push('', ...renderFlagged(`${pages(bugs.length)} ${bugs.length === 1 ? 'looks' : 'look'} like ${bugs.length === 1 ? 'a bug' : 'bugs'}`, bugs, shared, BUGS_SHOWN));
    if (reviews.length) main.push('', ...renderFlagged(`${pages(reviews.length)} need${reviews.length === 1 ? 's' : ''} review`, reviews, shared, REVIEWS_SHOWN));
    if (intended.length) main.push('', ...renderIntended(intended, against));
    if (noise.length) main.push('', ...renderNoise(noise));
  } else {
    for (const [g, members] of ordered) main.push('', ...renderGroup(g, members));
    if (intent?.intentProvided) main.push('', 'Not judged against the intent on this run, because the summaries were skipped or did not finish.');
  }

  if (errors.length) {
    main.push('', `**${plural(errors.length, 'page')} failed to check**`);
    for (const e of errors.slice(0, ERRORS_SHOWN)) {
      main.push(`- ${label(e)}: ${plain(clip(e.errorMessage || 'Unknown error', 120))}`);
    }
    if (errors.length > ERRORS_SHOWN) main.push(`- and ${errors.length - ERRORS_SHOWN} more`);
  }

  const head = main.join('\n');
  const entries = all.map(renderPageDetail);
  const baselineEntries = newBaselines.map(nb => `- ${label(nb)}`);
  if (!entries.length && !baselineEntries.length) return head + '\n';

  const title = [entries.length ? `All ${entries.length} changed page${entries.length === 1 ? '' : 's'}` : '', baselineEntries.length ? plural(baselineEntries.length, 'new baseline') : '']
    .filter(Boolean)
    .join(' · ');
  const open = `\n\n<details><summary>${title}</summary>\n\n`;
  const close = '\n\n</details>\n';

  // Fill the fold until the comment would pass GitHub's limit, then say what was left out.
  let used = head.length + open.length + close.length;
  const body: string[] = [];
  let dropped = 0;
  for (const entry of entries) {
    if (dropped || used + entry.length + 1 > BUDGET) {
      dropped++;
      continue;
    }
    body.push(entry);
    used += entry.length + 1;
  }
  if (dropped) {
    body.push(`\n…and ${more(dropped, 'page')}, [see the run](${reviewUrl})`);
  } else if (baselineEntries.length) {
    const nb = ['', '**New baselines**', ...baselineEntries].join('\n');
    if (used + nb.length < BUDGET) body.push(nb);
    else body.push(`\n…and ${more(baselineEntries.length, 'new baseline')}, [see the run](${reviewUrl})`);
  }

  return (head + open + body.join('\n') + close).slice(0, MAX_COMMENT_LENGTH);
}
