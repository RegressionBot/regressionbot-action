import * as core from '@actions/core';
import * as github from '@actions/github';
import { RegressionBot, JobStatus, JobSummary, RunContext } from '@regressionbot/sdk';
import { renderComment, COMMENT_HEADING, FAILURE_HEADING } from './comment';

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
          const failureMarkdown = `${FAILURE_HEADING}\n\n${error.message}\n\nCheck the Actions log for details.`;
          await postOrUpdateComment(octokit, owner, repo, prNumber, failureMarkdown);
        }
      } catch (commentError: any) {
        core.warning(`⚠️ Failed to resolve PR or post failure comment: ${commentError.message}`);
      }
    }
    core.setFailed(error.message);
  }
}

function csv(name: string): string[] {
  return core.getInput(name).split(',').map(s => s.trim()).filter(Boolean);
}

async function handleCheck(sdk: RegressionBot) {
  const failOn = parseFailOn();
  const testOrigin = core.getInput('test-origin');
  const projectName = core.getInput('project');
  const baseOrigin = core.getInput('base-origin');

  if (!projectName && !baseOrigin) {
    throw new Error('You must provide either a project name ("project") or a base origin URL ("base-origin") to compare against.');
  }
  if (!testOrigin && !projectName) {
    throw new Error('"test-origin" is required unless "project" names a saved project to run.');
  }

  // Only what the user set is sent. The API compares every inline param against the
  // saved project config and rejects the run if any differ, so a default here is a bug.
  const sitemapUrl = core.getInput('sitemap-url');
  const devices = csv('devices');
  const scan = core.getInput('scan');
  const exclude = csv('exclude');
  const masks = csv('mask');
  const concurrencyInput = core.getInput('concurrency');
  const concurrency = concurrencyInput ? parseInt(concurrencyInput, 10) : NaN;
  const autoApprove = core.getBooleanInput('auto-approve');

  if (projectName) core.info(`📊 Project: ${projectName}`);
  if (baseOrigin) core.info(`🔍 Base Origin: ${baseOrigin}`);
  if (sitemapUrl) core.info(`🗺️ Sitemap URL: ${sitemapUrl}`);
  if (devices.length) core.info(`📱 Devices: ${devices.join(', ')}`);
  if (scan) core.info(`🔎 Scanning sitemap with pattern: "${scan}"`);
  if (exclude.length) core.info(`🚫 Excluding patterns: ${exclude.join(', ')}`);
  if (masks.length) core.info(`🎭 Hiding elements matching selectors: ${masks.join(', ')}`);
  if (!isNaN(concurrency)) core.info(`⚙️ Concurrency: ${concurrency}`);
  if (autoApprove) core.info('✨ Auto-approve baselines is enabled.');

  // The PR is resolved before the run so its title and description can say what it intends.
  const githubToken = core.getInput('github-token');
  const octokit = githubToken ? github.getOctokit(githubToken) : undefined;
  const { owner, repo } = github.context.repo;
  const prNumber = octokit ? await resolvePrNumber(octokit, owner, repo) : undefined;
  const runContext = await buildRunContext(octokit, owner, repo, prNumber);
  if (runContext) core.info(`🧭 Judging changes against: ${runContext.prTitle || runContext.changeDescription || 'the commit'}`);

  let job;
  if (testOrigin) {
    core.info(`🚀 Initializing RegressionBot visual test for: ${testOrigin}`);
    const builder = sdk.test(testOrigin);
    if (projectName) builder.forProject(projectName);
    if (baseOrigin) builder.against(baseOrigin);
    if (sitemapUrl) builder.sitemap(sitemapUrl);
    if (devices.length) builder.on(devices);
    if (scan) builder.scan(scan, { exclude });
    if (masks.length) builder.mask(masks);
    if (!isNaN(concurrency)) builder.concurrency(concurrency);
    if (autoApprove) builder.autoApprove(true);
    if (runContext) builder.withContext(runContext);
    job = await builder.run();
  } else {
    core.info(`🚀 Running saved project: ${projectName}`);
    job = await sdk.runProject(projectName, {
      baseOrigin: baseOrigin || undefined,
      sitemapUrl: sitemapUrl || undefined,
      devices: devices.length ? devices : undefined,
      scans: scan ? [{ pattern: scan, options: { exclude } }] : undefined,
      masks: masks.length ? masks : undefined,
      concurrency: isNaN(concurrency) ? undefined : concurrency,
      autoApprove: autoApprove || undefined,
      runContext,
    });
  }

  const skipSummaries = core.getBooleanInput('skip-summaries');

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
  const decision = summary.intentAssessment?.decision ?? 'not_judged';
  core.setOutput('decision', decision);

  // Generate GitHub Job Summary Markdown
  const markdown = await generateJobSummary(job.jobId, summary);

  if (octokit) {
    if (prNumber) {
      await postOrUpdateComment(octokit, owner, repo, prNumber, markdown);
    } else {
      core.info('ℹ️ github-token was provided, but no active Pull Request could be resolved for this run. Skipping posting pull request comment.');
    }
  }

  // Print console summary
  printConsoleSummary(summary);

  // Decide if we need to fail the action build
  const failOnError = core.getBooleanInput('fail-on-error');
  const failure = verdictFailure(summary, decision, failOn);

  if (failure) {
    core.setFailed(failure);
  } else if (summary.errorCount > 0 && failOnError) {
    core.setFailed(`⚠️ RegressionBot job completed with ${summary.errorCount} errors.`);
  } else {
    core.info('🎉 RegressionBot run finished successfully!');
  }
}

/**
 * `fail-on` decides what fails the check: any change, or only what the verdicts flag. Unset,
 * `fail-on-regression` keeps its old meaning. A run with no intent to judge against falls back
 * to failing on any change, so a missing PR description never turns a failure into a pass.
 */
function parseFailOn(): string {
  const failOn = core.getInput('fail-on').trim().toLowerCase();
  if (!failOn) return core.getBooleanInput('fail-on-regression') ? 'change' : 'none';
  if (!['change', 'review', 'bug', 'none'].includes(failOn)) {
    throw new Error(`Unknown fail-on value "${failOn}". Use change, review, bug or none.`);
  }
  return failOn;
}

function verdictFailure(summary: JobSummary, decision: string, failOn: string): string | undefined {
  if (failOn === 'none' || summary.regressionCount === 0) return undefined;

  const ia = summary.intentAssessment;
  if (failOn !== 'change' && decision === 'not_judged') {
    core.warning(`fail-on: ${failOn} needs verdicts, and this run was not judged. Failing on any change instead.`);
    failOn = 'change';
  }
  if (failOn === 'change') return `❌ RegressionBot detected ${summary.regressionCount} regressions.`;
  if (decision === 'fail') return `❌ RegressionBot flagged ${ia.bugCount} page(s) that look like bugs.`;
  if (failOn === 'review' && decision === 'review') {
    return `⚠️ RegressionBot found ${ia.needsReviewCount || summary.regressionCount} page(s) that need review.`;
  }
  return undefined;
}

/**
 * What this run is meant to change, so RegressionBot can judge each page as intended, a bug
 * or noise. Taken from the PR and commit unless `send-pr-context` is false; the
 * `change-description` and `expected-changes` inputs are always sent.
 */
async function buildRunContext(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number | undefined
): Promise<RunContext | undefined> {
  const ctx: RunContext = {};
  const description = core.getInput('change-description').trim();
  const expected = core.getMultilineInput('expected-changes').map(s => s.trim()).filter(Boolean);
  if (description) ctx.changeDescription = description;
  if (expected.length) ctx.expectedChanges = expected;

  if (core.getInput('send-pr-context') !== 'false') {
    const payload = github.context.payload;
    let pr: any = payload.pull_request;
    try {
      if (!pr && octokit && prNumber) {
        pr = (await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })).data;
      }
      if (pr) {
        ctx.prTitle = pr.title;
        if (pr.body) ctx.prDescription = String(pr.body).slice(0, 2000);
        ctx.gitCommitSha = pr.head?.sha;
      }
      ctx.gitCommitSha = ctx.gitCommitSha || github.context.sha || undefined;
      const message = payload.head_commit?.message;
      if (message) {
        ctx.gitCommitMessage = String(message).split('\n')[0];
      } else if (octokit && ctx.gitCommitSha) {
        const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: ctx.gitCommitSha });
        ctx.gitCommitMessage = String(data.commit?.message ?? '').split('\n')[0] || undefined;
      }
      if (octokit && pr) {
        const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: pr.number, per_page: 100 });
        const scope = files.map((f: any) => f.filename).slice(0, 50);
        if (scope.length) ctx.scope = scope;
      }
    } catch (error: any) {
      core.warning(`⚠️ Could not read the PR to judge changes against: ${error.message}`);
    }
  }

  const keys = Object.keys(ctx).filter(k => (ctx as any)[k] !== undefined);
  // A SHA alone says nothing about intent, so it is not worth a judgement.
  return keys.some(k => k !== 'gitCommitSha') ? ctx : undefined;
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

// The same markdown goes to the PR comment, the job summary and the `summary` output.
async function generateJobSummary(jobId: string, summary: JobSummary): Promise<string> {
  const markdown = renderComment(jobId, summary);
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
      c.body.includes(COMMENT_HEADING) || c.body.includes(FAILURE_HEADING)
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
