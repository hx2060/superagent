import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 本地预览自动同步：PR 合并到 origin/main 后，把预览工作树推进到最新，
 * 避免"PR 已合并但本地端口看到的还是旧骨架"。
 *
 * 逻辑（每次运行）：
 * 1. git fetch origin；
 * 2. 比较 HEAD 与 origin/main；
 * 3. 工作树有未提交的跟踪文件改动时放弃本次同步并告警（不破坏本地修改；
 *    `local/` 等未跟踪内容不受影响）；
 * 4. 否则 git reset --hard origin/main。
 *
 * 静态服务（scripts/serve.mjs）按请求实时读盘且 Cache-Control: no-store，
 * 同步后刷新页面即可看到新骨架，无需重启服务。
 */

/**
 * 纯决策函数：根据当前状态决定同步动作。
 *
 * @param {{ head: string, remote: string, dirty: boolean }} state
 * @returns {{ action: 'up-to-date' | 'sync' | 'abort-dirty', from?: string, to?: string }}
 */
export function decideSyncAction({ head, remote, dirty }) {
  if (dirty) return { action: 'abort-dirty' };
  if (head === remote) return { action: 'up-to-date' };
  return { action: 'sync', from: head, to: remote };
}

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * 执行一次同步。
 *
 * @param {{ cwd?: string, remote?: string, branch?: string, log?: (msg: string) => void }} options
 * @returns {{ action: string, from?: string, to?: string }}
 */
export function runSync({ cwd = process.cwd(), remote = 'origin', branch = 'main', log = () => {} } = {}) {
  const remoteRef = `refs/remotes/${remote}/${branch}`;
  git(['fetch', remote, `+${branch}:${remoteRef}`], cwd);
  const head = git(['rev-parse', 'HEAD'], cwd);
  const remoteHead = git(['rev-parse', remoteRef], cwd);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], cwd) !== '';

  const plan = decideSyncAction({ head, remote: remoteHead, dirty });
  if (plan.action === 'sync') {
    git(['reset', '--hard', remoteRef], cwd);
    log(`synced ${plan.from.slice(0, 8)} -> ${plan.to.slice(0, 8)}`);
  } else if (plan.action === 'abort-dirty') {
    log('工作树有未提交改动，跳过同步（可 git stash / 提交后重试）');
  } else {
    log('已是最新');
  }
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const timestamp = new Date().toISOString();
  const lines = [];
  const result = runSync({
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    log: (msg) => lines.push(msg),
  });
  console.log(`[${timestamp}] ${JSON.stringify(result)}`);
  for (const line of lines) console.log(line);
}
