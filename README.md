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

---

## Usage

### 1. Basic Example: Compare Preview URL with Production

This workflow triggers a visual check whenever a PR is updated. It compares a staging URL against the production site and posts the results as a comment directly on the Pull Request.

```yaml
name: Visual Regression Test

on:
  pull_request:
    branches: [ main ]

# Required permissions for posting PR comments
permissions:
  contents: read
  pull-requests: write

jobs:
  visual-test:
    runs-on: ubuntu-latest
    steps:
      - name: Run RegressionBot Check
        uses: RegressionBot/regressionbot-action@v0
        with:
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          project: 'my-web-app'
          test-origin: 'https://staging.myapp.com'
          base-origin: 'https://myapp.com'
          devices: 'Desktop Chrome, iPhone 13'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 2. Full Matrix Sitemap Scan

For larger projects, you can scan your sitemap and check only specific paths or glob matches, with concurrency controls and element masking:

```yaml
      - name: Scan Sitemap for Regressions
        uses: RegressionBot/regressionbot-action@v0
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
        uses: RegressionBot/regressionbot-action@v0
        with:
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          project: 'my-web-app'
          auto-approve: true
```

### Intent-aware results

On a `pull_request` event the action sends the PR title, description, head commit and changed files to RegressionBot as **intent context**. Each regression is then judged against it as `intentional`, `bug`, `noise` or `needs_review`, and the PR comment leads with a one-line verdict such as *"All 2 regression(s) match the stated intent. Safe to approve."* Bugs are listed first.

Nothing changes in how the build passes or fails unless you opt in:

```yaml
      - uses: RegressionBot/regressionbot-action@v0
        with:
          api-key: ${{ secrets.REGRESSIONBOT_API_KEY }}
          project: 'my-web-app'
          test-origin: ${{ steps.deploy.outputs.preview-url }}
          base-origin: 'https://myapp.com'
          github-token: ${{ secrets.GITHUB_TOKEN }}
          change-description: 'Larger hero heading, green CTA'   # optional, sharpens the judgement
          fail-on: unintended                                     # only bugs and needs-review fail the build
```

`fail-on: unintended` passes the build only when RegressionBot's job-level intent decision is `pass`: every changed page was judged intentional or noise. A decision of `fail` (a page contradicts the intent), `review` (a page needs a person, or was never judged) or `not_judged` (no intent was sent) fails the build, so `skip-summaries: true` or a run with no context behaves like `fail-on: any`.

Two things decide how often you get `pass`:

- **A specific PR title or description.** A page is `intentional` only when the intent names the change, and the comment quotes the words that cover it. A vague title such as "Minor fixes" makes `intentional` unavailable, and every change lands in `review`. Write what changed and why, or set `change-description`.
- **Something to judge against.** A commit SHA and a file list alone are not intent. A `push` event with no commit message, or a PR with an empty title, gets no verdict.

A wrong "intentional" verdict lets a change through, so keep the default `any` on branches where that matters.

**Opting out.** Set `send-pr-context: false` and the action reads nothing from the pull request or commit. Only `change-description` and `expected-changes` are sent, if you set them. The PR body is truncated to 2000 characters by the API, and RegressionBot treats it as untrusted input to the model.

### Managed mode vs. live-vs-live

- **Live-vs-live** (`base-origin` set): both URLs are captured and compared on every run. Nothing is stored, so any inputs go. Use this for preview-vs-production.
- **Managed** (no `base-origin`): the run is compared against the baselines saved on the project. The API locks the saved config: any input you also pass here (`test-origin`, `devices`, `concurrency`, `scan`, `mask`, ...) must match what is stored, or the run is rejected with "Params differ from stored config". Anything you omit is filled from the saved config, so the simplest managed run is `project` alone. Change the config in the RegressionBot dashboard, not in the workflow.

### 4. AWS Amplify Workflow (Dynamic Previews)

Listen for AWS Amplify preview builds to succeed, dynamically parse the preview URL, and trigger a visual regression check against production:

> [!IMPORTANT]
> The AWS Amplify check run `details_url` points directly to the AWS Console build details page, which requires authentication and cannot be crawled. You must construct your public preview URL dynamically (e.g. `https://pr-${PR_NUMBER}.<appid>.amplifyapp.com`) or parse it from a custom deployment payload.

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
              if (checkRun.pull_requests && checkRun.pull_requests.length > 0) {
                prNumber = checkRun.pull_requests[0].number;
              }
              // Construct your public preview URL (e.g. using your Amplify App ID and PR number)
              previewUrl = `https://pr-${prNumber}.d123456789.amplifyapp.com`;
            }
            core.setOutput('url', previewUrl);
            core.setOutput('pr', prNumber);

      - name: Run Visual Check
        if: steps.env.outputs.url != ''
        uses: RegressionBot/regressionbot-action@v0
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

> [!CAUTION]
> Running issue comment workflows on public repositories can expose you to security vulnerabilities if anyone can execute them. Ensure you always verify the commenter's association permissions (`OWNER` or `COLLABORATOR`) before running the approval command.

```yaml
name: ChatOps Approval

on:
  issue_comment:
    types: [created]

jobs:
  approve:
    # Restrict executions to owners or collaborators to prevent unauthorized approvals
    if: |
      github.event.issue.pull_request && 
      startsWith(github.event.comment.body, '/approve-visual') &&
      (github.event.comment.author_association == 'COLLABORATOR' || github.event.comment.author_association == 'OWNER')
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
        uses: RegressionBot/regressionbot-action@v0
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
| `project` | The project name in RegressionBot. Created on first run if it does not exist. | No (req. if no `base-origin`) | N/A |
| `test-origin` | The URL of the candidate environment to test. | No (req. if no `project`) | N/A |
| `base-origin` | The baseline URL/origin to compare against. | No | N/A |
| `sitemap-url` | Explicit sitemap location (e.g. `https://example.com/sitemap.xml`). | No | N/A |
| `devices` | Comma-separated list of devices to test (e.g., `Desktop Chrome, iPhone 13`). | No | `Desktop Chrome`, or the saved project config |
| `scan` | Glob pattern to discover URLs within the sitemap (e.g., `/**`, `/docs/**`). | No | N/A |
| `exclude` | Comma-separated glob patterns to exclude from scanning. | No | N/A |
| `auto-approve` | Automatically promote test screenshots to baselines (`true`/`false`). | No | `false` |
| `mask` | Comma-separated CSS selectors to mask/hide. | No | N/A |
| `concurrency` | Pages captured in parallel (1-20). | No | `4`, or the saved project config |
| `skip-summaries` | Skip waiting for RegressionBot regression summaries (`true`/`false`). | No | `false` |
| `job-id` | The Job ID (required only for `approve` or `status` commands). | No | N/A |
| `fail-on-regression` | Fail the GitHub Action workflow if regressions are found (`true`/`false`). | No | `true` |
| `fail-on-error` | Fail the GitHub Action workflow if execution errors occur (`true`/`false`). | No | `true` |
| `change-description` | What this run is meant to change, for intent judgement. | No | N/A |
| `expected-changes` | Comma-separated list of expected visual changes. | No | N/A |
| `send-pr-context` | Read PR title, body, commit and changed files as intent context. `false` sends nothing from the PR. | No | `true` |
| `fail-on` | `any` regression fails the build, or only `unintended` ones (bug or needs review). | No | `any` |
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
| `intent-summary` | One line on how the changes line up with the stated intent. Empty when no intent was sent. |
| `bug-count` | Regressions judged unintended. |
| `intentional-count` | Regressions judged intentional. |
| `needs-review-count` | Regressions the judgement could not settle. |

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
