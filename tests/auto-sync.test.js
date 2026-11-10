import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decideSyncAction, runSync } from '../scripts/auto-sync.mjs';

const run = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('决策：干净且一致时保持不动', () => {
  assert.equal(decideSyncAction({ head: 'a', remote: 'a', dirty: false }).action, 'up-to-date');
});

test('决策：落后时同步，并记录前后提交', () => {
  const plan = decideSyncAction({ head: 'aaaa1111', remote: 'bbbb2222', dirty: false });
  assert.equal(plan.action, 'sync');
  assert.equal(plan.from, 'aaaa1111');
  assert.equal(plan.to, 'bbbb2222');
});

test('决策：工作树脏时放弃，避免覆盖本地修改', () => {
  assert.equal(decideSyncAction({ head: 'a', remote: 'b', dirty: true }).action, 'abort-dirty');
});

test('端到端：远端 main 前进后，工作树推进到远端提交', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-sync-'));
  try {
    run(['init', '-b', 'main'], dir);
    run(['config', 'user.email', 't@example.com'], dir);
    run(['config', 'user.name', 't'], dir);

    const commit = (msg) => {
      writeFileSync(join(dir, 'f.txt'), `${msg}\n`);
      run(['add', '.'], dir);
      run(['commit', '-m', msg], dir);
    };
    commit('one');
    run(['remote', 'add', 'origin', dir], dir);
    const oldHead = run(['rev-parse', 'HEAD'], dir);

    // 在 main 上再提交一次（模拟远端 main 已合并新 PR），然后把本地 HEAD
    // 切回旧提交，让工作树落后于远端。仓库自身充当远端，fetch 会把它的
    // main 写入 refs/remotes/origin/main。
    commit('two');
    run(['checkout', '--detach', oldHead], dir);

    const messages = [];
    const plan = runSync({ cwd: dir, log: (m) => messages.push(m) });
    assert.equal(plan.action, 'sync');
    assert.equal(run(['rev-parse', 'HEAD'], dir), run(['rev-parse', 'refs/remotes/origin/main'], dir));
    assert.ok(messages.some((m) => m.startsWith('synced')));

    // 再次运行：已最新。
    assert.equal(runSync({ cwd: dir }).action, 'up-to-date');

    // 工作树有未提交改动时放弃同步。
    writeFileSync(join(dir, 'f.txt'), 'dirty\n');
    assert.equal(runSync({ cwd: dir }).action, 'abort-dirty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
