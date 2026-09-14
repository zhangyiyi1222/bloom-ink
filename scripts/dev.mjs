import { spawn } from 'node:child_process';

/**
 * 开发模式：一边监听前端构建，一边以 --watch 跑服务端。
 * 生产环境请用 npm run build && npm start。
 */
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const vite = spawn(npx, ['vite', 'build', '--watch'], { stdio: 'inherit', shell: false });
const server = spawn(process.execPath, ['--watch', 'src/server/index.mjs'], { stdio: 'inherit' });

const shutdown = () => {
  vite.kill();
  server.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
