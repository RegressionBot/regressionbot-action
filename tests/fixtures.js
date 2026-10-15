// Job summaries shaped like GET /job/{id}/summary, for the PR comment tests.

const ORIGIN = 'https://preview.example.com';

const DOC_PATHS = [
  '/docs/', '/docs/api/', '/docs/status/', '/docs/install/', '/docs/config/',
  '/docs/accounts/', '/docs/orders/', '/docs/payments/', '/docs/refunds/', '/docs/shipping/',
  '/docs/returns/', '/docs/inventory/', '/docs/catalog/', '/docs/search/', '/docs/webhooks/',
  '/docs/events/', '/docs/errors/', '/docs/rate-limits/', '/docs/pagination/', '/docs/auth/',
  '/docs/teams/', '/docs/billing/', '/docs/limits/', '/docs/sandbox/', '/docs/sdks/',
  '/docs/migrations/', '/docs/security/', '/docs/privacy/', '/docs/faq/', '/docs/troubleshooting/',
  '/docs/changelog/',
];

const SIDEBAR_INSERT = { type: 'insert', element: 'a', after: 'Status page' };
const SIDEBAR_SHIFT = { type: 'reflow-displacement', element: 'ul' };

function base(overrides) {
  return {
    jobId: 'job-123',
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
    diffUrl: `https://regressionbot.com/inspect/job-123${path}`,
    changes: [SIDEBAR_INSERT, SIDEBAR_SHIFT],
    regressionbotSummary: [{ label: 'A', text: 'The sidebar gained a "Status page" link.' }],
    ...extra,
  };
}

// A docs site where every page gained one sidebar link; two pages also had their own edits.
function sidebarRun() {
  const regressions = DOC_PATHS.map(path => {
    if (path === '/docs/api/') {
      return page(path, {
        changes: [
          SIDEBAR_INSERT,
          { type: 'text-edit', element: 'code', before: '{"orderId":"abc","status":"PROCESSING","items":{"total":12,"shipped":3}}', after: '{"orderId":"abc","status":"PROCESSING","estimatedDelivery":"2026-11-02","items":{"total":12,"shipped":3}}' },
          { type: 'attribute-edit', element: 'a', label: 'Open in playground', attributes: { href: ['/playground?pid=920&tab=json', '/playground?pid=921&tab=json'] } },
          { type: 'insert', element: 'p', after: 'estimatedDelivery is set once the order ships; until then it is null, so check for it before showing a date.' },
          SIDEBAR_SHIFT,
        ],
        regressionbotSummary: 'ABCDEFGHIJK'.split('').map(label => ({
          label,
          text: `Response example now reads {"orderId":"abc","status":"PROCESSING","estimatedDelivery":"2026-11-02","items":{"total":12,"shipped":3,"percent":"25"},"results":[{"url":"https://preview.example.com/docs/api/#${label}"}]}`,
        })),
      });
    }
    if (path === '/docs/status/') {
      return page(path, {
        changes: [
          SIDEBAR_INSERT,
          { type: 'text-edit', element: 'h1', before: 'Status', after: 'Status page' },
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
    runSummary: 'Every docs page gained a "Status page" link in the sidebar. The API reference also documents a new estimatedDelivery field, and the Status page renamed its heading to match.',
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

module.exports = { sidebarRun, nullSummaryRun, errorsOnlyRun, noChangeRun, hugeRun };
