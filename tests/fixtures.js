// Job summaries shaped like GET /job/{id}/summary, for the PR comment tests.

const ORIGIN = 'https://preview.example.com';

const DOC_PATHS = [
  '/docs/', '/docs/api/', '/docs/quick-check/', '/docs/getting-started/', '/docs/projects/',
  '/docs/devices/', '/docs/masks/', '/docs/baselines/', '/docs/approvals/', '/docs/github-action/',
  '/docs/sdk/', '/docs/cli/', '/docs/scheduling/', '/docs/notifications/', '/docs/webhooks/',
  '/docs/sitemaps/', '/docs/scans/', '/docs/exclusions/', '/docs/concurrency/', '/docs/verdicts/',
  '/docs/run-context/', '/docs/changes/', '/docs/metadata/', '/docs/fonts/', '/docs/auth/',
  '/docs/teams/', '/docs/billing/', '/docs/limits/', '/docs/faq/', '/docs/troubleshooting/',
  '/docs/changelog/',
];

const SIDEBAR_INSERT = { type: 'insert', element: 'a', after: 'Quick Check (Low Fidelity)' };
const SIDEBAR_SHIFT = { type: 'reflow-displacement', element: 'ul' };

function base(overrides) {
  return {
    jobId: 'job-277',
    status: 'COMPLETED',
    summaryStatus: 'COMPLETE',
    error: null,
    totalUrls: 0,
    completedCount: 0,
    overallScore: 100,
    executionTime: 1000,
    regressionCount: 0,
    matchCount: 0,
    newBaselineCount: 0,
    errorCount: 0,
    regressions: [],
    matches: [],
    newBaselines: [],
    errors: [],
    runSummary: null,
    intentAssessment: { intentProvided: false, bugCount: 0, intentionalCount: 0, noiseCount: 0, needsReviewCount: 0, allAccountedFor: false, summary: '' },
    ...overrides,
  };
}

function page(path, extra = {}) {
  return {
    url: ORIGIN + path,
    status: 'SUCCESS',
    variantName: 'Desktop Chrome',
    changed: true,
    contentChanged: true,
    diffPercentage: 1.4,
    visualMatchScore: 97.2,
    isNewBaseline: false,
    changeGroup: 'structural',
    baselineUrl: null,
    currentUrl: null,
    diffUrl: `https://regressionbot.com/inspect/job-277${path}`,
    changes: [SIDEBAR_INSERT, SIDEBAR_SHIFT],
    regressionbotSummary: [{ label: 'A', text: 'The sidebar gained a "Quick Check (Low Fidelity)" link.' }],
    ...extra,
  };
}

// The PR #277 run: every docs page gained one sidebar link; two pages also had their own edits.
function sidebarRun() {
  const regressions = DOC_PATHS.map(path => {
    if (path === '/docs/api/') {
      return page(path, {
        changes: [
          SIDEBAR_INSERT,
          { type: 'text-edit', element: 'code', before: '{"jobId":"abc","status":"PROCESSING","progress":{"total":12,"completed":3}}', after: '{"jobId":"abc","status":"PROCESSING","summaryStatus":"PENDING","progress":{"total":12,"completed":3}}' },
          { type: 'attribute-edit', element: 'a', label: 'Open in playground', attributes: { href: ['/playground?pid=920&tab=json', '/playground?pid=921&tab=json'] } },
          { type: 'insert', element: 'p', after: 'summaryStatus tells you whether the RegressionBot summaries have been written yet; poll until it reads COMPLETE before reading them.' },
          SIDEBAR_SHIFT,
        ],
        regressionbotSummary: 'ABCDEFGHIJK'.split('').map(label => ({
          label,
          text: `Response example now reads {"jobId":"abc","status":"PROCESSING","summaryStatus":"PENDING","progress":{"total":12,"completed":3,"percent":"25"},"results":[{"url":"https://preview.example.com/docs/api/#${label}"}]}`,
        })),
      });
    }
    if (path === '/docs/quick-check/') {
      return page(path, {
        changes: [
          SIDEBAR_INSERT,
          { type: 'text-edit', element: 'h1', before: 'Quick Check', after: 'Quick Check (Low Fidelity)' },
        ],
      });
    }
    return page(path);
  });
  return base({
    totalUrls: 120,
    completedCount: 120,
    overallScore: 98,
    regressionCount: regressions.length,
    matchCount: 120 - regressions.length,
    regressions,
    runSummary: 'Every docs page gained a "Quick Check (Low Fidelity)" link in the sidebar. The API reference also documents the new summaryStatus field, and the Quick Check page renamed its heading to match.',
  });
}

function nullSummaryRun() {
  const regressions = [
    page('/pricing/', { changeGroup: 'edited', changes: [{ type: 'text-edit', element: 'span', before: '$49/mo', after: '$59/mo' }] }),
    page('/about/', { changeGroup: 'cosmetic', changes: [{ type: 'style-only', element: 'button', label: 'Contact us', style: { 'background-color': ['rgb(0, 0, 0)', 'rgb(20, 20, 200)'] } }] }),
    page('/team/', { changeGroup: 'cosmetic', changes: [{ type: 'style-only', element: 'h2', style: { 'font-size': ['24px', '28px'] } }] }),
  ];
  return base({ totalUrls: 10, regressionCount: 3, matchCount: 7, regressions, runSummary: null });
}

function errorsOnlyRun() {
  const errors = Array.from({ length: 7 }, (_, i) => ({
    url: `${ORIGIN}/broken-${i + 1}/`,
    variantName: 'Desktop Chrome',
    errorMessage: i === 0 ? 'Navigation timeout of 30000 ms exceeded' : 'net::ERR_NAME_NOT_RESOLVED',
  }));
  return base({ totalUrls: 7, errorCount: 7, errors });
}

function noChangeRun() {
  return base({ totalUrls: 42, matchCount: 42 });
}

// Big enough that the folded page list alone passes GitHub's 65,536-character limit.
function hugeRun() {
  const regressions = Array.from({ length: 400 }, (_, i) =>
    page(`/blog/post-${i}/`, {
      changeGroup: i % 2 ? 'edited' : 'structural',
      changes: [
        SIDEBAR_INSERT,
        { type: 'text-edit', element: 'p', before: `Original paragraph number ${i} with a fair amount of text in it to take up room.`, after: `Rewritten paragraph number ${i} with a fair amount of text in it to take up room.` },
      ],
    })
  );
  return base({ totalUrls: 400, regressionCount: 400, regressions, runSummary: 'Every blog post gained a sidebar link and had its body copy rewritten.' });
}

// The same run judged against its PR: one bug, one page to review, two noise, the rest intended.
function verdictRun() {
  const run = sidebarRun();
  const verdict = (decision, extra = {}) => ({ decision, minConfidence: 0.9, avgConfidence: 0.9, regions: {}, basis: 'measured', ...extra });
  run.regressions.forEach((r, i) => {
    const path = new URL(r.url).pathname;
    if (path === '/docs/api/') {
      r.verdict = verdict('bug', { reasoning: 'The PR only adds a sidebar link; it does not mention the API playground, and its link now points at a different project.' });
    } else if (path === '/docs/quick-check/') {
      r.verdict = verdict('needs_review', { reasoning: 'The heading rename may be intended, but the PR only names the sidebar.' });
    } else if (i >= 29) {
      r.verdict = verdict('noise', { reasoning: 'Only the sidebar shifted by a pixel.' });
    } else {
      r.verdict = verdict('intentional', { coveredBy: 'add Quick Check (Low Fidelity) to the docs sidebar', reasoning: 'The PR adds this link.' });
    }
  });
  run.runContext = { prTitle: 'Add Quick Check to the docs nav', prDescription: 'add Quick Check (Low Fidelity) to the docs sidebar' };
  run.intentAssessment = {
    decision: 'fail', intentProvided: true, bugCount: 1, intentionalCount: 27, noiseCount: 2, needsReviewCount: 1,
    allAccountedFor: false, summary: '1 page contradicts the PR and 1 needs review; 27 match it.',
  };
  return run;
}

// The run carried a PR, but summaries were skipped, so nothing was judged.
function unjudgedRun() {
  const run = sidebarRun();
  run.summaryStatus = 'PENDING';
  run.runSummary = null;
  run.intentAssessment = { ...run.intentAssessment, intentProvided: true, decision: 'review' };
  return run;
}

module.exports = { sidebarRun, nullSummaryRun, errorsOnlyRun, noChangeRun, hugeRun, verdictRun, unjudgedRun };
