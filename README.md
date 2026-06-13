# 🚀 RegressionBot GitHub Action

[![Build & Test](https://github.com/RegressionBot/regressionbot-action/actions/workflows/ci.yml/badge.svg)](https://github.com/RegressionBot/regressionbot-action/actions)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Official Website](https://img.shields.io/badge/Website-regressionbot.com-blueviolet)](https://regressionbot.com)

The official GitHub Action for [RegressionBot.com](https://regressionbot.com) — the ultimate developer-first platform for automated, lightning-fast, and zero-maintenance visual regression testing.

Stop worrying about CSS bugs, unexpected layout shifts, or broken mobile views slipping into production. [RegressionBot](https://regressionbot.com) automatically crawls your staging and preview environments, runs multi-device matrix tests, performs high-fidelity pixel comparison, and reports detailed visual diff metrics—all without writing a single line of browser automation code.

This action runs declarative visual regression tests against your candidate environments, compares screenshots with baselines (or base origins), and reports the results directly within your GitHub pull requests and workflow runs.

---

## Why RegressionBot?

- **🎯 Unrivaled Visual Accuracy**: Catches real visual regressions with high-fidelity, pixel-by-pixel comparisons and layout shift detection. Avoid the headache of false positives by focusing only on true UI changes.
- **🤖 Plain-English Visual Summaries**: Eliminates the guesswork. RegressionBot automatically generates human-readable descriptions of what visually changed on each page (e.g., *"Font color in footer changed from green to orange"* or *"Added new baseline image next to heading"*), so you can review UI updates in seconds instead of squinting at visual diff lines.
- **🧠 Built for Agentic Workflows**: RegressionBot is natively designed to integrate with AI coding agents (such as Antigravity) and MCP tools. Coding agents can autonomously trigger tests, parse natural English summaries, and handle automated approval/rejection flows in CI/CD pipelines.
- **✨ Zero Infrastructure Maintenance**: No headless browsers to manage, no grid servers to scale. All rendering, comparisons, and matrix runs are handled asynchronously on our blazing-fast, secure cloud infrastructure.
- **💬 Developer-First Feedback Loop**: Delivers visual check results directly into your Pull Request comments and GitHub Step Summaries with links to interactive side-by-side comparison images.
- **📱 True Matrix Testing**: Test any page across a variety of default viewports and devices (including Desktop Chrome, Safari, iPhone, Android, and Tablets) out-of-the-box.
- **🛡️ Intelligent Element Masking**: Prevent false positives from dynamic content (like ads, video players, and live timestamps) by using simple CSS selector masking.
- **🗺️ Sitemap Auto-Discovery**: Point RegressionBot to your sitemap, filter target directories with glob patterns, and let it handle the rest automatically.

---

## Usage

### 1. Basic Example: Compare Preview URL with Production

This workflow triggers a visual check whenever a PR is updated. It compares a staging URL against the production site.

```yaml
name: Visual Regression Test

on:
  pull_request:
    branches: [ main ]

jobs:
  visual-test:
    runs-on: ubuntu-latest
    steps:
      - name: Run RegressionBot Check
        uses: RegressionBot/regressionbot-action@v1
        with:
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          project: 'my-web-app'
          test-origin: 'https://staging.myapp.com'
          base-origin: 'https://myapp.com'
          devices: 'Desktop Chrome, iPhone 13'
```

### 2. Full Matrix Sitemap Scan

For larger projects, you can scan your sitemap and check only specific paths or glob matches, with concurrency controls and element masking:

```yaml
      - name: Scan Sitemap for Regressions
        uses: RegressionBot/regressionbot-action@v1
        with:
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          project: 'marketing-site'
          test-origin: 'https://staging.myapp.com'
          base-origin: 'https://myapp.com'
          sitemap-url: 'https://myapp.com/sitemap_index.xml'
          scan: '/blog/**'
          exclude: '/blog/drafts/**, /blog/categories/**'
          mask: '.ads, #cookie-banner, .current-time'
          concurrency: 15
          fail-on-regression: true
```

### 3. Automatically Approve on Main/Production Builds

When changes are merged into your production branch, you may want to automatically promote the new screenshots to be your visual baselines:

```yaml
name: Deploy and Approve Baselines

on:
  push:
    branches: [ main ]

jobs:
  deploy-and-approve:
    runs-on: ubuntu-latest
    steps:
      - name: Update Baselines
        uses: RegressionBot/regressionbot-action@v1
        with:
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          project: 'my-web-app'
          test-origin: 'https://myapp.com'
          auto-approve: true
```

### 4. AWS Amplify Workflow (Dynamic Previews)

Listen for AWS Amplify preview builds to succeed, dynamically parse the preview URL, and trigger a visual regression check against production:

```yaml
name: Visual Regression (AWS Amplify)

on:
  check_run:
    types: [completed]
  workflow_dispatch:
    inputs:
      preview-url:
        description: 'Manual Preview URL to test'
        required: true
      pr-number:
        description: 'PR Number'
        required: false

jobs:
  visual-check:
    if: |
      github.event_name == 'workflow_dispatch' ||
      (
        github.event_name == 'check_run' && 
        github.event.check_run.conclusion == 'success' && 
        contains(github.event.check_run.name, 'Amplify')
      )
    runs-on: ubuntu-latest
    steps:
      - name: Extract Environment Info
        id: env
        uses: actions/github-script@v7
        with:
          script: |
            let previewUrl = '';
            let prNumber = '';
            if (context.eventName === 'workflow_dispatch') {
              previewUrl = context.payload.inputs['preview-url'];
              prNumber = context.payload.inputs['pr-number'];
            } else {
              const checkRun = context.payload.check_run;
              previewUrl = checkRun.details_url;
              if (checkRun.pull_requests && checkRun.pull_requests.length > 0) {
                prNumber = checkRun.pull_requests[0].number;
              }
            }
            core.setOutput('url', previewUrl);
            core.setOutput('pr', prNumber);

      - name: Run Visual Check
        if: steps.env.outputs.url != ''
        uses: RegressionBot/regressionbot-action@v1
        with:
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          test-origin: ${{ steps.env.outputs.url }}
          project: "my-amplify-site"
          base-origin: "https://www.your-production-site.com"
          sitemap-url: "${{ steps.env.outputs.url }}/sitemap.xml"
          devices: "Desktop Chrome"
          github-token: ${{ secrets.GITHUB_TOKEN }}
          pr-number: ${{ steps.env.outputs.pr }}
```

### 5. ChatOps Approval Workflow

Update your baselines directly from a Pull Request comment using ChatOps (e.g. typing `/approve-visual <job-id>`):

```yaml
name: ChatOps Approval

on:
  issue_comment:
    types: [created]

jobs:
  approve:
    if: github.event.issue.pull_request && startsWith(github.event.comment.body, '/approve-visual')
    runs-on: ubuntu-latest
    steps:
      - name: Parse Job ID
        id: parse
        uses: actions/github-script@v7
        with:
          script: |
            const body = context.payload.comment.body;
            const parts = body.trim().split(/\s+/);
            if (parts.length < 2) {
              core.setFailed('Missing Job ID. Usage: /approve-visual <job-id>');
              return;
            }
            core.setOutput('job_id', parts[1].trim());

      - name: Run Approval
        uses: RegressionBot/regressionbot-action@v1
        with:
          command: 'approve'
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          job-id: ${{ steps.parse.outputs.job_id }}
```

---

## API Reference

### Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `api-key` | Your RegressionBot API Key. | **Yes** | N/A |
| `command` | The action command to run (`check`, `approve`, `status`). | No | `check` |
| `project` | The target Project ID configured in RegressionBot. | No (req. if no `base-origin`) | N/A |
| `test-origin` | The URL of the candidate environment to test. | Yes (for `check`) | N/A |
| `base-origin` | The baseline URL/origin to compare against. | No | N/A |
| `sitemap-url` | Explicit sitemap location (e.g. `https://example.com/sitemap.xml`). | No | N/A |
| `devices` | Comma-separated list of devices to test (e.g., `Desktop Chrome, iPhone 13`). | No | `Desktop Chrome` |
| `scan` | Glob pattern to discover URLs within the sitemap (e.g., `/**`, `/docs/**`). | No | N/A |
| `exclude` | Comma-separated glob patterns to exclude from scanning. | No | N/A |
| `auto-approve` | Automatically promote test screenshots to baselines (`true`/`false`). | No | `false` |
| `mask` | Comma-separated CSS selectors to mask/hide. | No | N/A |
| `concurrency` | Max concurrent worker instances (1-20). | No | `10` |
| `skip-summaries` | Skip waiting for RegressionBot regression summaries (`true`/`false`). | No | `false` |
| `job-id` | The Job ID (required only for `approve` or `status` commands). | No | N/A |
| `fail-on-regression` | Fail the GitHub Action workflow if regressions are found (`true`/`false`). | No | `true` |
| `fail-on-error` | Fail the GitHub Action workflow if execution errors occur (`true`/`false`). | No | `true` |
| `github-token` | GitHub token (`${{ secrets.GITHUB_TOKEN }}`) to automatically post/update a PR comment with test results. | No | N/A |
| `pr-number` | Explicit PR number to comment on (auto-detected if omitted on PR/issue events). | No | N/A |

### Outputs

| Output | Description |
| --- | --- |
| `job-id` | The ID of the visual regression test job. |
| `status` | The final status of the job (e.g. `COMPLETED`, `FAILED`, `APPROVED`). |
| `overall-score` | The overall visual stability score (0-100). |
| `regression-count` | The number of page regressions detected. |
| `error-count` | The number of pages that failed to crawl/test. |
| `summary` | The full Markdown summary detailing the run results. |

## Security & Permissions

### Secrets Management
The `api-key` input is a sensitive credential used to authenticate requests to RegressionBot. **Never hardcode this API key in your workflow files.** Always store it as a GitHub Secret (e.g., `REGRESSIONBOT_API_KEY`) and reference it using the secret context:
```yaml
api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
```

### Least Privilege Permissions
For optimal security, it is recommended to run this action (and your workflows) with the minimum required permissions. This action only needs read-only access to repository contents to run checks. You can configure this explicitly at the workflow or job level:
```yaml
permissions:
  contents: read
```

### Version Pinning
For production pipelines, consider pinning the action to a specific commit SHA rather than a tag to protect against upstream dependency tampering or unexpected tag updates:
```yaml
uses: RegressionBot/regressionbot-action@c2d6e3c8f8b... # Replace with actual commit SHA
```

---

## Development

If you want to contribute to this action or run it locally, clone this repository and follow these steps:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile TypeScript and bundle with `esbuild`:
   ```bash
   npm run build
   ```

3. Run the tests:
   ```bash
   npm test
   ```

---

License: ISC
