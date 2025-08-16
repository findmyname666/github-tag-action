import { context, getOctokit } from '@actions/github';
import * as core from '@actions/core';
import { Await } from './ts';

let octokitSingleton: ReturnType<typeof getOctokit>;

type Tag = {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  zipball_url: string;
  tarball_url: string;
  node_id: string;
};

export function getOctokitSingleton() {
  if (octokitSingleton) {
    return octokitSingleton;
  }
  const githubToken = core.getInput('github_token');
  octokitSingleton = getOctokit(githubToken);
  return octokitSingleton;
}

/**
 * Fetch all tags for a given repository recursively
 */
export async function listTags(
  shouldFetchAllTags = false,
  fetchedTags: Tag[] = [],
  page = 1
): Promise<Tag[]> {
  const octokit = getOctokitSingleton();

  const tags = await octokit.repos.listTags({
    ...context.repo,
    per_page: 100,
    page,
  });

  if (tags.data.length < 100 || shouldFetchAllTags === false) {
    return [...fetchedTags, ...tags.data];
  }

  return listTags(shouldFetchAllTags, [...fetchedTags, ...tags.data], page + 1);
}

/**
 * Compare `headRef` to `baseRef` (i.e. baseRef...headRef)
 * @param baseRef - old commit
 * @param headRef - new commit
 */
export async function compareCommitsWithFiles(baseRef: string, headRef: string) {
  const octokit = getOctokitSingleton();
  core.debug(`Comparing commits with files (${baseRef}...${headRef})`);

  // Get the comparison data
  const comparison = await octokit.repos.compareCommits({
    ...context.repo,
    base: baseRef,
    head: headRef,
  });

  // Fetch detailed file information for each commit
  const commitsWithFiles = await Promise.all(
    comparison.data.commits.map(async (commit) => {
      const commitDetails = await octokit.repos.getCommit({
        ...context.repo,
        ref: commit.sha,
      });

      return {
        ...commit,
        files: commitDetails.data.files || []
      };
    })
  );

  return commitsWithFiles;
}

export async function createTag(
  newTag: string,
  createAnnotatedTag: boolean,
  GITHUB_SHA: string
) {
  const octokit = getOctokitSingleton();
  let annotatedTag:
    | Await<ReturnType<typeof octokit.git.createTag>>
    | undefined = undefined;
  if (createAnnotatedTag) {
    core.debug(`Creating annotated tag.`);
    annotatedTag = await octokit.git.createTag({
      ...context.repo,
      tag: newTag,
      message: newTag,
      object: GITHUB_SHA,
      type: 'commit',
    });
  }

  core.debug(`Pushing new tag to the repo.`);
  await octokit.git.createRef({
    ...context.repo,
    ref: `refs/tags/${newTag}`,
    sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
  });
}
