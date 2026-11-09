import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { resolveFilePath } from '../scripts/serve.mjs';

const ROOT = '/repo';
const CONTENT = '/repo/local/examples';

test('serve：普通路径解析到仓库根', () => {
  assert.equal(resolveFilePath(ROOT, '/'), '/repo/index.html');
  assert.equal(resolveFilePath(ROOT, '/index.html'), '/repo/index.html');
  assert.equal(resolveFilePath(ROOT, '/src/app.js'), '/repo/src/app.js');
  assert.equal(resolveFilePath(ROOT, '/assets/styles.css'), '/repo/assets/styles.css');
});

test('serve：/local/* 由内容目录提供，测试实例不会暴露真实本地内容', () => {
  assert.equal(resolveFilePath(CONTENT, '/schedule.json'), '/repo/local/examples/schedule.json');
  assert.equal(resolveFilePath(CONTENT, '/'), '/repo/local/examples/index.html');
});

test('serve：默认内容目录即 local/', () => {
  assert.equal(resolveFilePath(join(ROOT, 'local'), '/schedule.json'), '/repo/local/schedule.json');
});

test('serve：点号段（.git 等）被拒绝', () => {
  assert.equal(resolveFilePath(ROOT, '/.git/config'), null);
  assert.equal(resolveFilePath(ROOT, '/.env'), null);
  assert.equal(resolveFilePath(CONTENT, '/.git/config'), null);
});

test('serve：目录逃逸被拒绝', () => {
  assert.equal(resolveFilePath(ROOT, '/../etc/passwd'), null);
  assert.equal(resolveFilePath(ROOT, '/src/../../etc/passwd'), null);
  assert.equal(resolveFilePath(CONTENT, '/../schedule.json'), null);
});
