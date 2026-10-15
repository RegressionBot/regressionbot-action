const assert = require('assert');
const path = require('path');

// Keep track of calls
const logs = [];
const outputs = {};
let failedMessage = null;

// Mock @actions/core before loading the bundle
// Since we want to test the compiled bundle, we can mock process.stdout.write
// and intercept core outputs, or mock the require cache.
// However, since ncc bundles everything, we can't easily mock '@actions/core' 
// via require cache inside the bundle unless we mock the environment variables 
// and stdout.
// Let's mock process.env for inputs:
process.env['INPUT_API-KEY'] = 'test-api-key-123';
process.env['INPUT_COMMAND'] = 'check';
process.env['INPUT_TEST-ORIGIN'] = 'https://preview.example.com';
process.env['INPUT_PROJECT'] = 'test-project';
process.env['INPUT_DEVICES'] = 'Desktop Chrome, iPhone 13';
process.env['INPUT_AUTO-APPROVE'] = 'false';
process.env['INPUT_SKIP-SUMMARIES'] = 'true';
process.env['INPUT_FAIL-ON-REGRESSION'] = 'false';
process.env['INPUT_FAIL-ON-ERROR'] = 'true';

// Intercept outputs that GitHub Action core writes
// GitHub Actions uses special stdout formatting for outputs:
// ::set-output name=job-id::123
// ::error::something
// For Node 20 / modern actions, it also uses environment files like GITHUB_OUTPUT, GITHUB_STEP_SUMMARY.
// Let's create temporary files for GITHUB_OUTPUT and GITHUB_STEP_SUMMARY.
const fs = require('fs');
const tempOutputDir = path.join(__dirname, '../.regressionbot-tmp');
if (!fs.existsSync(tempOutputDir)) {
  fs.mkdirSync(tempOutputDir, { recursive: true });
}

const githubOutputFile = path.join(tempOutputDir, 'github_output');
const githubSummaryFile = path.join(tempOutputDir, 'github_summary');
const githubEventFile = path.join(tempOutputDir, 'github_event.json');
fs.writeFileSync(githubOutputFile, '');
fs.writeFileSync(githubSummaryFile, '');
fs.writeFileSync(githubEventFile, JSON.stringify({
  pull_request: { number: 123 }
}));

process.env.GITHUB_OUTPUT = githubOutputFile;
process.env.GITHUB_STEP_SUMMARY = githubSummaryFile;
process.env.GITHUB_EVENT_PATH = githubEventFile;
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_NAME = 'pull_request';
process.env['INPUT_GITHUB-TOKEN'] = 'mock-github-token';

// Mock global.fetch
const originalFetch = global.fetch;
const fetchCalls = [];

global.fetch = async (url, options) => {
  const urlStr = typeof url === 'string' ? url : (url.url || String(url));
  console.log('DEBUG FETCH CALL:', urlStr);
  fetchCalls.push({ url: urlStr, options });

  const parsedUrl = new URL(urlStr);
  
  if (parsedUrl.pathname === '/crawl') {
    assert.strictEqual(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.strictEqual(body.project, 'test-project');
    assert.strictEqual(body.testOrigin, 'https://preview.example.com');
    assert.deepStrictEqual(body.devices, ['Desktop Chrome', 'iPhone 13']);
    return {
      ok: true,
      json: async () => ({ jobId: 'job-xyz-987' })
    };
  }
  
  if (parsedUrl.pathname === '/project/saved-proj/run') {
    assert.strictEqual(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepStrictEqual(body, { autoApprove: true }, 'Paramless project run must send only what the user set');
    return {
      ok: true,
      json: async () => ({ jobId: 'job-xyz-987' })
    };
  }

  if (parsedUrl.pathname === '/job/job-xyz-987') {
    return {
      ok: true,
      json: async () => ({
        jobId: 'job-xyz-987',
        status: 'COMPLETED',
        progress: { total: 2, completed: 2, percent: '100' }
      })
    };
  }

  if (parsedUrl.pathname === '/job/job-xyz-987/summary') {
    return {
      ok: true,
      json: async () => ({
        jobId: 'job-xyz-987',
        status: 'COMPLETED',
        overallScore: 90,
        totalUrls: 2,
        regressionCount: 1,
        newBaselineCount: 0,
        matchCount: 1,
        errorCount: 0,
        regressions: [
          {
            url: 'https://preview.example.com/blog',
            variantName: 'Desktop Chrome',
            visualMatchScore: 90.5,
            diffUrl: 'https://regressionbot.com/diff-1.png',
            regressionbotSummary: [
              { label: 'Header', text: 'Increased font size.' },
              { text: 'Button color changed.' }
            ]
          }
        ],
        newBaselines: [],
        matches: [
          { url: 'https://preview.example.com/', variantName: 'iPhone 13' }
        ],
        errors: []
      })
    };
  }

  return {
    ok: false,
    status: 404,
    json: async () => ({ message: 'Not found' })
  };
};

const http = require('http');
const fixtures = require('./fixtures');

// The comment renderer is pure, so test it straight from source rather than through the bundle.
function loadRenderer() {
  const outfile = path.join(tempOutputDir, 'comment.js');
  require('esbuild').buildSync({
    entryPoints: [path.join(__dirname, '../src/comment.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'warning',
  });
  return require(outfile);
}

// Everything a reader sees without opening the fold.
function visible(markdown) {
  return markdown.split('<details>')[0].trim();
}

function runCommentTests() {
  const { renderComment, MAX_COMMENT_LENGTH, COMMENT_HEADING } = loadRenderer();
  const count = (text, needle) => text.split(needle).length - 1;

  // 31 pages that share one sidebar edit, two of them with edits of their own.
  const sidebar = renderComment('job-277', fixtures.sidebarRun());
  const top = visible(sidebar);
  assert.ok(sidebar.startsWith(COMMENT_HEADING), 'Comment keeps the marker postOrUpdateComment looks for');
  assert.ok(top.includes('**31 pages changed** · [Review the run →](https://regressionbot.com/admin/jobs?id=job-277)'), 'Headline counts pages and links the run');
  assert.ok(top.includes('Every docs page gained'), 'runSummary is the summary paragraph');
  assert.ok(top.includes('**31 pages gained or lost content**'), 'Group heading names the group');
  assert.strictEqual(count(top, 'Quick Check (Low Fidelity)”'), 2, 'Shared edit is said once (plus the heading rename on its own page)');
  assert.ok(top.includes('- On 31 of 31 pages: added “Quick Check (Low Fidelity)”'), 'Shared edit carries its page count');
  assert.ok(top.includes('`/docs/api/`') && top.includes('`/docs/quick-check/`'), 'Pages with their own edits are listed');
  assert.ok(!top.includes('`/docs/faq/`'), 'Pages with only the shared edit are not listed');
  assert.ok(top.includes('link pid=920 → pid=921'), 'href change shows only the query values that differ');
  assert.ok(top.includes('“…"PROCESSING","progress":{"total"…” → “…"PROCESSING","summaryStatus":"PENDING"…”'), 'Text edit is quoted from where the sides diverge');
  assert.ok(top.split('\n').length < 40, `Comment outside <details> is under 40 lines (was ${top.split('\n').length})`);
  assert.ok(!/Stability Score|Score:|\| Metric/.test(sidebar), 'Pixel scores and the metrics table are gone');
  assert.ok(!/https?:\/\/preview\.example\.com/.test(sidebar), 'No whole page URLs');
  assert.ok(!/\{"jobId"/.test(sidebar.split('<details>')[1].replace(/“[^”]*”/g, '')), 'No JSON blobs in the per-page summaries');
  for (const line of top.split('\n').filter(l => l.startsWith('-') || l.startsWith(' '))) {
    assert.ok(line.length <= 120, `Edit line too long: ${line}`);
  }
  assert.ok(sidebar.includes('<details><summary>All 31 changed pages</summary>'), 'Every page is folded into <details>');
  assert.strictEqual(count(sidebar, '[diff]('), 31, 'Every page keeps its diff link');
  assert.ok(/\n<\/details>\n$/.test(sidebar), 'Fold is closed');
  assert.ok(!/<(?!\/?(details|summary)>)[a-z]/i.test(sidebar), 'No HTML other than <details>/<summary>');
  console.log('✅ Shared-edit comment verified.');

  // No runSummary: one line naming the largest group stands in for it.
  const fallback = visible(renderComment('job-1', fixtures.nullSummaryRun()));
  assert.ok(fallback.includes('Most of the changes: 2 pages changed only in appearance.'), 'Fallback names the largest group');
  assert.ok(fallback.indexOf('**1 page edited its wording**') < fallback.indexOf('**2 pages changed only in appearance**'), 'Groups follow the fixed order');
  assert.ok(fallback.includes('button “Contact us” restyled: background-color rgb(0, 0, 0) → rgb(20, 20, 200)'), 'Style edits name the element and the property');
  console.log('✅ runSummary fallback verified.');

  // Errors only: shown, capped at five, never folded.
  const errorsOnly = renderComment('job-2', fixtures.errorsOnlyRun());
  assert.ok(errorsOnly.includes('**7 errors** · [Review the run →]'), 'Headline omits zero counts');
  assert.ok(!errorsOnly.includes('changed'), 'No changed-pages count when none changed');
  assert.ok(errorsOnly.includes('- `/broken-1/`: Navigation timeout of 30000 ms exceeded'), 'Error line has path and message');
  assert.strictEqual(count(errorsOnly, '- `/broken-'), 5, 'At most five errors are listed');
  assert.ok(errorsOnly.includes('- and 2 more'), 'The rest are counted');
  assert.ok(!errorsOnly.includes('<details>'), 'Errors are never folded');
  console.log('✅ Errors-only comment verified.');

  // Nothing changed: one line.
  const none = renderComment('job-3', fixtures.noChangeRun());
  assert.strictEqual(none, `${COMMENT_HEADING}\n\nNo pages changed (42 checked)\n`, 'No-change comment is a single line under the marker');
  console.log('✅ No-change comment verified.');

  // A run too big for one comment: the fold is cut, and says so.
  const huge = renderComment('job-4', fixtures.hugeRun());
  assert.ok(huge.length <= MAX_COMMENT_LENGTH, `Comment fits GitHub's limit (was ${huge.length})`);
  assert.ok(/…and \d+ more pages, \[see the run\]\(https:\/\/regressionbot\.com\/admin\/jobs\?id=job-4\)/.test(huge), 'Truncation is stated with a link to the run');
  assert.ok(/\n<\/details>\n$/.test(huge), 'Fold is still closed after truncation');
  assert.ok(visible(huge).includes('**400 pages changed**'), 'Headline still counts every page');
  console.log('✅ Size limit verified.');
}

async function runTest() {
  runCommentTests();

  console.log('Running GitHub Action Integration Test...');

  // Start a local HTTP server to mock GitHub REST API
  const mockGithubComments = [
    { id: 456, body: '### 🚀 RegressionBot Visual Test Results\nSome old results' }
  ];
  let githubCommentUpdated = false;

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/repos/test-owner/test-repo/issues/123/comments') {
      res.statusCode = 200;
      res.end(JSON.stringify(mockGithubComments));
      return;
    }
    if (req.method === 'PATCH' && req.url === '/repos/test-owner/test-repo/issues/comments/456') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        assert.ok(parsed.body.includes('**1 page changed** · [Review the run →](https://regressionbot.com/admin/jobs?id=job-xyz-987)'));
        githubCommentUpdated = true;
        res.statusCode = 200;
        res.end(JSON.stringify({ id: 456 }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'Not found' }));
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  process.env.GITHUB_API_URL = `http://localhost:${port}`;

  // Require the compiled bundle
  try {
    require('../dist/index.js');
  } catch (err) {
    console.error('Failed to run action bundle:', err);
    server.close();
    process.exit(1);
  }

  // Wait a bit to ensure async operations complete since the action is an IIFE
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Verify fetch calls
  assert.ok(fetchCalls.length >= 3, 'Should have called /crawl, /job/:id, and /job/:id/summary');
  console.log('✅ SDK / API Fetch calls verified successfully.');

  // Verify output file contents
  const outputContent = fs.readFileSync(githubOutputFile, 'utf8');
  console.log('Generated outputs:\n' + outputContent);
  assert.ok(outputContent.includes('job-id') && outputContent.includes('job-xyz-987'), 'Should output job-id');
  assert.ok(outputContent.includes('status') && outputContent.includes('COMPLETED'), 'Should output status');
  assert.ok(outputContent.includes('overall-score') && outputContent.includes('90'), 'Should output overall-score');
  assert.ok(outputContent.includes('regression-count') && outputContent.includes('1'), 'Should output regression-count');
  assert.ok(outputContent.includes('error-count') && outputContent.includes('0'), 'Should output error-count');
  console.log('✅ GitHub Action outputs verified successfully.');

  // Verify step summary contents
  const summaryContent = fs.readFileSync(githubSummaryFile, 'utf8');
  console.log('Generated summary:\n' + summaryContent);
  // This summary predates changeGroup, changes and runSummary (and summaries were skipped):
  // the comment must still render from what is there, with no "pending" placeholder.
  assert.ok(summaryContent.includes('### 🚀 RegressionBot Visual Test Results'), 'Should contain title');
  assert.ok(summaryContent.includes('**1 page changed**'), 'Should contain the headline');
  assert.ok(summaryContent.includes('**1 page changed visually, with no text diff**'), 'Should group a page with no edits as unmeasured');
  assert.ok(summaryContent.includes('  - Increased font size.'), 'Should fall back to the RegressionBot summary text');
  assert.ok(summaryContent.includes('  - Header: Increased font size.'), 'Should keep the labelled summary in the fold');
  assert.ok(!/pending|waiting/i.test(summaryContent), 'Should never show a pending placeholder');
  assert.ok(!summaryContent.includes('Stability Score'), 'Should not show the stability score');
  assert.ok(outputContent.includes('**1 page changed**'), 'Should set the same markdown as the summary output');
  console.log('✅ GitHub Step Summary verified successfully.');

  // Verify GitHub PR comment was updated
  assert.ok(githubCommentUpdated, 'Should have updated the existing GitHub PR comment');
  console.log('✅ GitHub PR comment update verified successfully.');

  // Second scenario: project only, no test-origin -> runs the saved config, sends no defaults
  process.env['INPUT_TEST-ORIGIN'] = '';
  process.env['INPUT_PROJECT'] = 'saved-proj';
  process.env['INPUT_DEVICES'] = '';
  process.env['INPUT_AUTO-APPROVE'] = 'true';
  process.env['INPUT_GITHUB-TOKEN'] = '';
  fetchCalls.length = 0;
  delete require.cache[require.resolve('../dist/index.js')];
  require('../dist/index.js');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.ok(fetchCalls.some(c => c.url.endsWith('/project/saved-proj/run')), 'Should run the saved project');
  assert.ok(!fetchCalls.some(c => c.url.endsWith('/crawl')), 'Should not call /crawl without test-origin');
  console.log('✅ Saved-project run verified successfully.');

  // Cleanup
  server.close();
  fs.rmSync(tempOutputDir, { recursive: true, force: true });
  global.fetch = originalFetch;

  console.log('🎉 ALL INTEGRATION TESTS PASSED!');
}

runTest();
