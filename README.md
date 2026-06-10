# RegressionBot GitHub Action

The official GitHub Action for [RegressionBot.com](https://regressionbot.com) — the simplest way to automate visual regression testing in your CI/CD pipeline.

This action runs declarative visual regression tests against your candidate environments, compares screenshots with baselines (or base origins), and reports the results directly within your GitHub pull requests and workflow runs.

## Features

- 🚀 **Fast CI Integration**: Runs visual regression tests dynamically as part of your pull requests or deployments.
- 💬 **GitHub Job Summary**: Publishes detailed visual diff metrics and links directly to GitHub's Step Summary.
- 📱 **Matrix Testing**: Easily configures tests across multiple devices (Desktop, Mobile, etc.) in parallel.
- 🔎 **Sitemap Discovery & Exclusions**: Automatically crawls pages using glob patterns.
- 🎭 **CSS Selector Masking**: Automatically masks dynamic/noisy elements (e.g., ads, timestamps) to prevent false positives.
- 🤖 **AI-Generated Summaries**: Pulls plain-English descriptions of what changed on pages with regressions.

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
| `skip-summaries` | Skip waiting for AI-generated regression summaries (`true`/`false`). | No | `false` |
| `job-id` | The Job ID (required only for `approve` or `status` commands). | No | N/A |
| `fail-on-regression` | Fail the GitHub Action workflow if regressions are found (`true`/`false`). | No | `true` |
| `fail-on-error` | Fail the GitHub Action workflow if execution errors occur (`true`/`false`). | No | `true` |

### Outputs

| Output | Description |
| --- | --- |
| `job-id` | The ID of the visual regression test job. |
| `status` | The final status of the job (e.g. `COMPLETED`, `FAILED`, `APPROVED`). |
| `overall-score` | The overall visual stability score (0-100). |
| `regression-count` | The number of page regressions detected. |
| `error-count` | The number of pages that failed to crawl/test. |
| `summary` | The full Markdown summary detailing the run results. |

---

## Development

If you want to contribute to this action or run it locally, clone this repository and follow these steps:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile TypeScript and bundle with `@vercel/ncc`:
   ```bash
   npm run build
   ```

3. Run the tests:
   ```bash
   npm test
   ```

---

License: ISC
