import * as core from '@actions/core';
import * as github from '@actions/github';
import { RegressionBot, JobStatus, JobSummary } from 'regressionbot';

async function run() {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const command = core.getInput('command') || 'check';
    const sdk = new RegressionBot(apiKey);

    if (command === 'check') {
      await handleCheck(sdk);
    } else if (command === 'approve') {
      await handleApprove(sdk);
    } else if (command === 'status') {
      await handleStatus(sdk);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (error: any) {
    const githubToken = core.getInput('github-token');
    const command = core.getInput('command') || 'check';
    if (githubToken && command === 'check') {
      try {
        const octokit = github.getOctokit(githubToken);
        const { owner, repo } = github.context.repo;
        const prNumber = await resolvePrNumber(octokit, owner, repo);
        if (prNumber) {
          const failureMarkdown = `### ⚠️ RegressionBot Visual Check Failed\n\n${error.message}\n\nCheck the Actions log for details.`;
          await postOrUpdateComment(octokit, owner, repo, prNumber, failureMarkdown);
        }
      } catch (commentError: any) {
        core.warning(`⚠️ Failed to resolve PR or post failure comment: ${commentError.message}`);
      }
    }
    core.setFailed(error.message);
  }
}

async function handleCheck(sdk: RegressionBot) {
  const testOrigin = core.getInput('test-origin', { required: true });
  const projectId = core.getInput('project');
  const baseOrigin = core.getInput('base-origin');

  if (!projectId && !baseOrigin) {
    throw new Error('You must provide either a project ID ("project") or a base origin URL ("base-origin") to compare against.');
  }

  core.info(`🚀 Initializing RegressionBot visual test for: ${testOrigin}`);

  const builder = sdk.test(testOrigin);

  if (projectId) {
    builder.forProject(projectId);
    core.info(`📊 Project ID: ${projectId}`);
  }

  if (baseOrigin) {
    builder.against(baseOrigin);
    core.info(`🔍 Base Origin: ${baseOrigin}`);
  }

  const sitemapUrl = core.getInput('sitemap-url');
  if (sitemapUrl) {
    builder.sitemap(sitemapUrl);
    core.info(`🗺️ Sitemap URL: ${sitemapUrl}`);
  }

  // Parse devices
  const devicesInput = core.getInput('devices') || 'Desktop Chrome';
  const devices = devicesInput.split(',').map(d => d.trim()).filter(Boolean);
  if (devices.length > 0) {
    builder.on(devices);
    core.info(`📱 Devices: ${devices.join(', ')}`);
  }

  // Parse scan/exclude
  const scan = core.getInput('scan');
  if (scan) {
    const excludeInput = core.getInput('exclude');
    const exclude = excludeInput ? excludeInput.split(',').map(e => e.trim()).filter(Boolean) : [];
    builder.scan(scan, { exclude });
    core.info(`🔎 Scanning sitemap with pattern: "${scan}"`);
    if (exclude.length > 0) {
      core.info(`🚫 Excluding patterns: ${exclude.join(', ')}`);
    }
  }

  // Parse auto-approve
  const autoApprove = core.getBooleanInput('auto-approve');
  if (autoApprove) {
    builder.autoApprove(true);
    core.info(`✨ Auto-approve baselines is enabled.`);
  }

  // Parse masks
  const maskInput = core.getInput('mask');
  if (maskInput) {
    const masks = maskInput.split(',').map(m => m.trim()).filter(Boolean);
    if (masks.length > 0) {
      builder.mask(masks);
      core.info(`🎭 Hiding elements matching selectors: ${masks.join(', ')}`);
    }
  }

  // Parse concurrency
  const concurrencyInput = core.getInput('concurrency');
  if (concurrencyInput) {
    const concurrency = parseInt(concurrencyInput, 10);
    if (!isNaN(concurrency)) {
      builder.concurrency(concurrency);
      core.info(`⚙️ Concurrency: ${concurrency}`);
    }
  }

  const skipSummaries = core.getBooleanInput('skip-summaries');

  // Trigger the job
  const job = await builder.run();
  core.info(`✅ Job successfully created! Job ID: ${job.jobId}`);
  core.setOutput('job-id', job.jobId);

  core.info('Waiting for job completion...');

  let lastPercent = -1;
  let lastStatus = '';
  let lastSummaryStatus = '';
  const status = await job.waitForCompletion(
    3000,
    (s: JobStatus) => {
      const percent = s.progress?.percent ? parseInt(s.progress.percent, 10) : 0;
      const currentStatus = s.status;
      const currentSummaryStatus = s.summaryStatus || '';
      if (
        percent !== lastPercent ||
        currentStatus !== lastStatus ||
        currentSummaryStatus !== lastSummaryStatus
      ) {
        const showSummary = !!currentSummaryStatus;
        const summaryPart = showSummary
          ? ` [RegressionBot Summary: ${currentSummaryStatus}]`
          : '';
        core.info(`Status: ${currentStatus} (${percent}%)${summaryPart}`);
        lastPercent = percent;
        lastStatus = currentStatus;
        lastSummaryStatus = currentSummaryStatus;
      }
    },
    { waitForSummaries: !skipSummaries }
  );

  core.info(`\nJob ended with status: ${status.status}`);
  core.setOutput('status', status.status);

  const summary = await job.getSummary();
  core.setOutput('overall-score', summary.overallScore.toString());
  core.setOutput('regression-count', summary.regressionCount.toString());
  core.setOutput('error-count', summary.errorCount.toString());

  // Generate GitHub Job Summary Markdown
  const markdown = await generateJobSummary(job.jobId, summary);

  const githubToken = core.getInput('github-token');
  if (githubToken) {
    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;
    const prNumber = await resolvePrNumber(octokit, owner, repo);
    if (prNumber) {
      await postOrUpdateComment(octokit, owner, repo, prNumber, markdown);
    } else {
      core.info('ℹ️ github-token was provided, but no active Pull Request could be resolved for this run. Skipping posting pull request comment.');
    }
  }

  // Print console summary
  printConsoleSummary(summary);

  // Decide if we need to fail the action build
  const failOnRegression = core.getBooleanInput('fail-on-regression');
  const failOnError = core.getBooleanInput('fail-on-error');

  if (summary.regressionCount > 0 && failOnRegression) {
    core.setFailed(`❌ RegressionBot detected ${summary.regressionCount} regressions.`);
  } else if (summary.errorCount > 0 && failOnError) {
    core.setFailed(`⚠️ RegressionBot job completed with ${summary.errorCount} errors.`);
  } else if (status.status === 'FAILED') {
    core.setFailed(`❌ RegressionBot job failed: ${status.error}`);
  } else {
    core.info('🎉 RegressionBot run finished successfully!');
  }
}

async function handleApprove(sdk: RegressionBot) {
  const jobId = core.getInput('job-id', { required: true });
  core.info(`Approving baselines for Job ID: ${jobId}...`);
  const job = sdk.job(jobId);
  const result = await job.approve();
  core.info(`✅ ${result.message}`);
  core.setOutput('job-id', jobId);
  core.setOutput('status', 'APPROVED');
}

async function handleStatus(sdk: RegressionBot) {
  const jobId = core.getInput('job-id', { required: true });
  core.info(`Fetching status for Job ID: ${jobId}...`);
  const job = sdk.job(jobId);
  const status = await job.getStatus();
  core.info(`Job Status: ${status.status}`);
  if (status.progress) {
    core.info(`Progress: ${status.progress.percent}% (${status.progress.completed}/${status.progress.total})`);
  }
  core.setOutput('job-id', jobId);
  core.setOutput('status', status.status);
}

function getStabilityLabel(score: number): string {
  if (score === 100) {
    return '🟢 No Changes';
  } else if (score >= 95) {
    return '🟡 Minor Deviations';
  } else if (score >= 80) {
    return '🟠 Significant Changes';
  } else {
    return '🔴 Major Changes';
  }
}

function getUrlPath(urlStr: string): string {
  try {
    return new URL(urlStr).pathname;
  } catch (e) {
    return urlStr;
  }
}

function printConsoleSummary(summary: JobSummary) {
  core.startGroup('RegressionBot Run Summary');
  core.info(`Overall Score: ${summary.overallScore}/100 (${getStabilityLabel(summary.overallScore)})`);
  core.info(`Total Tasks: ${summary.totalUrls}`);
  core.info(`Regressions: ${summary.regressionCount}`);
  core.info(`New Baselines: ${summary.newBaselineCount}`);
  core.info(`Matches: ${summary.matchCount}`);
  core.info(`Errors: ${summary.errorCount}`);

  if (summary.newBaselineCount > 0) {
    core.info('\n✨ New Baselines Created:');
    summary.newBaselines.forEach((nb: any) => {
      core.info(`- ${getUrlPath(nb.url)} [${nb.variantName}]`);
    });
  }

  if (summary.regressions.length > 0) {
    core.info('\n❌ Regressions Found:');
    summary.regressions.forEach((r: any) => {
      core.info(`- ${getUrlPath(r.url)} [${r.variantName}] (Score: ${r.visualMatchScore.toFixed(2)})`);
      core.info(`  Diff Image: ${r.diffUrl}`);
      if (r.regressionbotSummary && Array.isArray(r.regressionbotSummary)) {
        core.info(`  RegressionBot Summary:`);
        r.regressionbotSummary.forEach((item: any) => {
          const prefix = item.label ? `${item.label}: ` : '';
          core.info(`    - ${prefix}${item.text}`);
        });
      } else if (r.regressionbotSummary) {
        core.info(`  RegressionBot Summary:`);
        if (typeof r.regressionbotSummary === 'string') {
          r.regressionbotSummary.split('\n').forEach((line: string) => {
            core.info(`    ${line}`);
          });
        } else {
          core.info(`    ${JSON.stringify(r.regressionbotSummary)}`);
        }
      }
    });
  }

  if (summary.errors.length > 0) {
    core.info('\n⚠️ Errors:');
    summary.errors.forEach((e: any) => {
      core.info(`- ${getUrlPath(e.url)}: ${e.errorMessage}`);
    });
  }
  core.endGroup();
}

async function generateJobSummary(jobId: string, summary: JobSummary): Promise<string> {
  let markdown = `### 🚀 RegressionBot Visual Test Results

**Job ID:** \`${jobId}\`
**Status:** \`${summary.status}\`
**Stability Score:** \`${summary.overallScore}/100\` (${getStabilityLabel(summary.overallScore)})

#### Summary Metrics
| Metric | Value |
| --- | --- |
| **Total URLs Tested** | ${summary.totalUrls} |
| **Matches** | ${summary.matchCount} |
| **Regressions** | ${summary.regressionCount} |
| **New Baselines** | ${summary.newBaselineCount} |
| **Errors** | ${summary.errorCount} |
`;

  if (summary.newBaselines && summary.newBaselines.length > 0) {
    markdown += `\n#### ✨ New Baselines Created\n`;
    summary.newBaselines.forEach((nb: any) => {
      let urlPath = nb.url;
      try {
        urlPath = new URL(nb.url).pathname;
      } catch (e) {
        // Ignored
      }
      markdown += `- \`${urlPath}\` [${nb.variantName}]\n`;
    });
  }

  if (summary.regressions && summary.regressions.length > 0) {
    markdown += `\n#### ❌ Regressions Detected\n`;
    summary.regressions.forEach((r: any) => {
      let urlPath = r.url;
      try {
        urlPath = new URL(r.url).pathname;
      } catch (e) {
        // Ignored
      }
      
      markdown += `- **${urlPath}** [${r.variantName}] (Score: **${r.visualMatchScore.toFixed(2)}**)`;
      if (r.diffUrl) {
        markdown += ` - [View Diff Image](${r.diffUrl})`;
      }
      markdown += '\n';

      if (r.regressionbotSummary && Array.isArray(r.regressionbotSummary)) {
        markdown += `  - **RegressionBot Summary:**\n`;
        r.regressionbotSummary.forEach((item: any) => {
          const prefix = item.label ? `**${item.label}**: ` : '';
          markdown += `    - ${prefix}${item.text}\n`;
        });
      } else if (r.regressionbotSummary) {
        markdown += `  - **RegressionBot Summary:**\n`;
        if (typeof r.regressionbotSummary === 'string') {
          r.regressionbotSummary.split('\n').forEach((line: string) => {
            markdown += `    ${line}\n`;
          });
        } else {
          markdown += `    ${JSON.stringify(r.regressionbotSummary)}\n`;
        }
      }
    });
  }

  if (summary.errors && summary.errors.length > 0) {
    markdown += `\n#### ⚠️ Errors Encountered\n`;
    summary.errors.forEach((e: any) => {
      let urlPath = e.url;
      try {
        urlPath = new URL(e.url).pathname;
      } catch (err) {
        // Ignored
      }
      markdown += `- **${urlPath}**: ${e.errorMessage}\n`;
    });
  }

  core.setOutput('summary', markdown);
  await core.summary.addRaw(markdown).write();
  return markdown;
}

async function resolvePrNumber(octokit: any, owner: string, repo: string): Promise<number | undefined> {
  const prNumberInput = core.getInput('pr-number');
  if (prNumberInput) {
    const num = parseInt(prNumberInput, 10);
    if (!isNaN(num)) {
      return num;
    }
  }

  if (github.context.payload.pull_request) {
    return github.context.payload.pull_request.number;
  }

  if (github.context.payload.issue && github.context.payload.issue.pull_request) {
    return github.context.payload.issue.number;
  }

  // Fallback 1: Search associated PRs by commit SHA
  if (github.context.sha) {
    try {
      core.info(`Searching for pull requests associated with commit ${github.context.sha}...`);
      const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: github.context.sha,
      });
      const openPr = prs.find((pr: any) => pr.state === 'open');
      if (openPr) {
        core.info(`Found open pull request #${openPr.number} associated with commit.`);
        return openPr.number;
      }
      if (prs.length > 0) {
        core.info(`Found pull request #${prs[0].number} associated with commit.`);
        return prs[0].number;
      }
    } catch (error: any) {
      core.debug(`Failed to find PR by commit SHA: ${error.message}`);
    }
  }

  // Fallback 2: Search open PRs by branch name
  const ref = github.context.ref;
  if (ref && ref.startsWith('refs/heads/')) {
    const branch = ref.replace('refs/heads/', '');
    try {
      core.info(`Searching for open pull requests for branch ${branch}...`);
      const { data: prs } = await octokit.rest.pulls.list({
        owner,
        repo,
        head: `${owner}:${branch}`,
        state: 'open',
      });
      if (prs.length > 0) {
        core.info(`Found open pull request #${prs[0].number} for branch.`);
        return prs[0].number;
      }
    } catch (error: any) {
      core.debug(`Failed to find PR by branch name: ${error.message}`);
    }
  }

  return undefined;
}

async function postOrUpdateComment(octokit: any, owner: string, repo: string, prNumber: number, body: string) {
  try {
    core.info(`💬 Posting results to Pull Request #${prNumber}...`);
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    const botComment = comments.find((c: any) =>
      c.body.includes('### 🚀 RegressionBot Visual Test Results') ||
      c.body.includes('### ⚠️ RegressionBot Visual Check Failed')
    );

    if (botComment) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: botComment.id,
        body,
      });
      core.info('💬 Pull Request comment updated successfully.');
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
      core.info('💬 Pull Request comment created successfully.');
    }
  } catch (error: any) {
    core.warning(`⚠️ Failed to post PR comment: ${error.message}`);
  }
}

run();
