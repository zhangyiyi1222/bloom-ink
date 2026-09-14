import os from 'node:os';
import { PORT, HOST } from '../src/server/config.mjs';

/* =====================================================================
   手机该开哪个地址？跑这一条就知道：
     node scripts/lan-url.mjs
   ===================================================================== */

const nets = os.networkInterfaces();
const ips = [];

for (const [name, list] of Object.entries(nets)) {
  for (const net of list || []) {
    if (net.family !== 'IPv4' || net.internal) continue;
    // 跳过虚拟网卡（VMware / VirtualBox / Hyper-V / WSL）
    if (/vmware|virtualbox|hyper-v|wsl|loopback|vethernet|docker/i.test(name)) continue;
    ips.push({ name, address: net.address });
  }
}

console.log('');
console.log('  前台（手机浏览器直接打开）：');
for (const { address } of ips) console.log(`    http://${address}:${PORT}/`);
if (!ips.length) console.log(`    http://127.0.0.1:${PORT}/  （只在本机）`);

console.log('');
console.log('  后台（写文章、传照片都在这里）：');
for (const { address } of ips) console.log(`    http://${address}:${PORT}/admin`);
if (!ips.length) console.log(`    http://127.0.0.1:${PORT}/admin`);

console.log('');
console.log(`  服务监听：${HOST}:${PORT}${HOST === '0.0.0.0' ? '（已对局域网开放）' : '（只有本机能访问，把 .env 的 HOST 改成 0.0.0.0）'}`);
console.log('  手机连不上时依次检查：');
console.log('    1. 手机和电脑在同一个 WiFi');
console.log('    2. 不是访客网络 / 没开“AP 隔离”');
console.log('    3. IP 变了 —— 重新跑一次这条命令，或在电脑上 ipconfig');
console.log('    4. Windows 防火墙里允许 Node.js（专用网络）');
console.log('');
