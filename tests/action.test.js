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
process.env['INPUT_FAIL-ON-REGRESSION'] = 'true';
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
fs.writeFileSync(githubOutputFile, '');
fs.writeFileSync(githubSummaryFile, '');

process.env.GITHUB_OUTPUT = githubOutputFile;
process.env.GITHUB_STEP_SUMMARY = githubSummaryFile;

// Mock global.fetch
const originalFetch = global.fetch;
const fetchCalls = [];

global.fetch = async (url, options) => {
  fetchCalls.push({ url, options });

  const parsedUrl = new URL(url);
  
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
        overallScore: 100,
        totalUrls: 2,
        regressionCount: 0,
        newBaselineCount: 0,
        matchCount: 2,
        errorCount: 0,
        regressions: [],
        newBaselines: [],
        matches: [
          { url: 'https://preview.example.com/', variantName: 'Desktop Chrome' },
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

async function runTest() {
  console.log('Running GitHub Action Integration Test...');

  // Require the compiled bundle
  try {
    require('../dist/index.js');
  } catch (err) {
    console.error('Failed to run action bundle:', err);
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
  assert.ok(outputContent.includes('overall-score') && outputContent.includes('100'), 'Should output overall-score');
  assert.ok(outputContent.includes('regression-count') && outputContent.includes('0'), 'Should output regression-count');
  assert.ok(outputContent.includes('error-count') && outputContent.includes('0'), 'Should output error-count');
  console.log('✅ GitHub Action outputs verified successfully.');

  // Verify step summary contents
  const summaryContent = fs.readFileSync(githubSummaryFile, 'utf8');
  console.log('Generated summary:\n' + summaryContent);
  assert.ok(summaryContent.includes('### 🚀 RegressionBot Visual Test Results'), 'Should contain title');
  assert.ok(summaryContent.includes('Job ID:** `job-xyz-987`'), 'Should contain Job ID');
  assert.ok(summaryContent.includes('Stability Score:** `100/100`'), 'Should contain Stability Score');
  console.log('✅ GitHub Step Summary verified successfully.');

  // Cleanup
  fs.rmSync(tempOutputDir, { recursive: true, force: true });
  global.fetch = originalFetch;

  console.log('🎉 ALL INTEGRATION TESTS PASSED!');
}

runTest();
