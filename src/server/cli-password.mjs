import readline from 'node:readline';
import { createUser, findUser, setPassword, userCount } from './auth.mjs';

/**
 * 在服务器上直接重置后台密码（忘记密码时用）：
 *   npm run admin:password
 */
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

const username = (await ask(`用户名（默认 admin）：`)) || 'admin';
const password = await ask('新密码（至少 8 位）：');

if (String(password).length < 8) {
  console.error('密码太短，至少 8 位。');
  process.exit(1);
}

const existing = findUser(username);
if (existing) {
  setPassword(existing.id, password);
  console.log(`已更新 ${username} 的密码。`);
} else {
  createUser(username, password);
  console.log(`已创建管理员 ${username}（当前共 ${userCount()} 个用户）。`);
}
rl.close();
