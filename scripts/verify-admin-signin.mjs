import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const account = JSON.parse(await readFile('.runtime/admin-bootstrap.json', 'utf8'));
const codePath = resolve('.runtime/temporary-learning-signin.cjs');
await writeFile(codePath, `async page => { await page.getByRole('textbox', {name:'请输入管理账号',exact:true}).fill(${JSON.stringify(account.username)}); await page.getByRole('textbox', {name:'请输入密码',exact:true}).fill(${JSON.stringify(account.password)}); await page.getByRole('button',{name:'登 录'}).click(); await page.waitForURL('**/dashboard/analysis'); }`);
try {
  const run = promisify(execFile);
  // Never forward CLI's echoed credentials or raw script to logs.
  const { stdout } = await run('C:/Program Files/nodejs/node.exe', ['C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js', '--cache', 'C:/Users/l6658/AppData/Local/daoxue-academy-dev/npm-cache', '--yes', '--package', '@playwright/cli', 'playwright-cli', '-s=daoxue-learning-admin', 'run-code', '--filename=' + codePath], { timeout: 60000, windowsHide: true }).catch(() => { throw new Error('Admin UI login failed; credential-bearing CLI output was suppressed.'); });
  if (stdout.includes('### Error')) throw new Error('Admin UI login failed; inspect page state without credentials.');
  console.log('Admin UI login succeeded.');
} finally { await unlink(codePath); }

