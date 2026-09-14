# 运维说明

## 一、环境变量（`项目根目录/.env`）

所有变量都有默认值，不配也能跑起来。**`.env` 不要提交到 git**（`.gitignore` 已经忽略它）。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址；要对外直接访问改成 `0.0.0.0`（更推荐用 Nginx 反代） |
| `SITE_TIMEZONE` | `Asia/Shanghai` | 文章日期与归档月份按这个时区计算 |
| `DATA_DIR` | `./data` | 数据库、上传文件、视觉素材、备份都放这里 |
| `SESSION_SECRET` | 自动生成并写入 `data/secret.key` | 会话签名密钥；多实例部署时必须显式设置成同一个值 |
| `COOKIE_SECURE` | 空 | 走 HTTPS 时设成 `1`，登录 Cookie 就只走加密连接 |
| `MAX_UPLOAD_MB` | `200` | 单个上传文件上限 |
| `IMAGE_PROVIDER` | `local` | `local`（本地程序化生成）或 `doubao`（火山方舟 / 豆包） |
| `ARK_API_KEY` | 空 | 方舟 API Key，**只放服务端** |
| `ARK_MODEL` | `doubao-seedream-3-0-t2i-250415` | 图像模型 ID（以控制台为准） |
| `ARK_ENDPOINT` | `https://ark.cn-beijing.volces.com/api/v3/images/generations` | 接口地址 |
| `IMAGE_SIZE` | `1024x1536` | 生成尺寸 |

## 二、接入图像生成 API（可选）

不配任何 API Key 也能用：`IMAGE_PROVIDER=local` 时，服务端会用程序化方式直接画出一张同气质的基础视觉，
首页照样是完整效果。要接豆包 / 火山方舟：

1. 去火山引擎控制台开通方舟的图像生成，拿到 API Key；
2. 在项目根目录新建 `.env`，写：

```
IMAGE_PROVIDER=doubao
ARK_API_KEY=你的密钥
ARK_MODEL=控制台里开通的模型 ID
```

3. 重启服务，然后后台 → 视觉 → 写描述 → 生成 → 设为当前。

> **风险提示**
> - 密钥只从服务端环境变量读取，前端页面、接口返回里都不会出现它；后台只显示「已配置 / 未配置」。
> - 生成一张图是要花钱的，`后台 → 视觉` 每次点生成默认出 3 张候选，请按需点。
> - 生成的历史图永远保留、不覆盖，长期使用建议偶尔清理 `data/visuals/`。

## 三、部署到服务器

最省事的做法（一台 Ubuntu/Debian 小机器就够）：

```bash
# 1. 装 Node 22.5+（用 nvm 或 nodesource）
node -v

# 2. 上传项目，然后
npm install
npm run build
npm run reset -- --keep-admin     # 只第一次：生成演示数据（除非你要自己写全新的内容）

# 3. 用 systemd 常驻（示例）
```

`/etc/systemd/system/bloom-ink.service`：

```ini
[Unit]
Description=Bloom Ink Blog
After=network.target

[Service]
WorkingDirectory=/srv/bloom-ink
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=COOKIE_SECURE=1
ExecStart=/usr/bin/node src/server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

Nginx 反代（示例片段）：

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  client_max_body_size 200m;      # 要能传视频就把这里放大
}
```

最后配 HTTPS（certbot 一行命令）。上 HTTPS 后记得把 `COOKIE_SECURE=1` 打开。

> **风险提示**
> - 部署前把 `后台 → 设置 → 域名` 改成你的真实域名，否则 canonical / sitemap / RSS 还是示例域名 `zhangzhongwei.top`。
> - `data/` 是整站唯一的真实数据，务必持久化（不要放在会被重建的容器层里）。
> - 把后台暴露在公网时，请一定用强密码；`/admin` 已带登录、限流和 `noindex`，但没有第二因素认证。

## 四、备份与恢复

```bash
npm run backup     # → data/backups/bloom-ink-<时间>.zip（文章 + 媒体 + 设置 + 视觉素材）
npm run export     # → data/markdown-export-<日期>.zip（只有文章，纯 Markdown）
```

**恢复**：把 `data/` 整个目录覆盖回去，重启服务即可（数据库是 SQLite 单文件，媒体是原样文件）。

建议：每周跑一次 `npm run backup`，把 zip 拷到别的地方（网盘 / 另一个磁盘）。
文章本身是 Markdown，即使数据库坏了，`npm run export` 出来的东西也能直接用。

## 五、常见问题

**端口被占用**：改 `.env` 里的 `PORT`，或者 `netstat -ano | findstr 8787` 找到占用进程。

**上传的图片没有生成 WebP**：`sharp` 是可选依赖，某些环境装不上。装不上时功能不受影响，
只是沿用原图、不生成优化版本和缩略图（日志里不会报错）。

**中文 URL 看着很长**：地址栏里会显示中文，复制出去是百分号编码，两者都是正常的。
如果你希望 URL 完全用英文，在后台把 slug 手填成英文即可。

**日期差一天**：确认 `SITE_TIMEZONE` 是 `Asia/Shanghai`（默认就是）。文章日期与归档月份都按它算。

**忘了后台密码**：在服务器上跑 `npm run admin:password` 重设。

**想彻底重来**：`npm run reset`（会清空文章、媒体、视觉和后台账号，重新生成演示数据）。

**想让首页重一点、文章轻一点**：首页才有 WebGL 世界；文章页没有任何持续运行的 shader，
`data/uploads/` 里的图会写死宽高避免跳版。手机、低配设备、以及系统里打开「减少动画」的用户
会自动降级：更低的帧率、更少的噪声层，切换世界退化成简洁的淡入淡出。

## 六、安全清单（上线前过一遍）

- [ ] 后台用强密码，并确认只有你一个人知道
- [ ] 全站 HTTPS，`COOKIE_SECURE=1`
- [ ] `SESSION_SECRET` 在 `data/secret.key` 里（或显式配置），不要把它提交到代码仓库
- [ ] 图像 API 的密钥只写在服务器 `.env` 里，不要写进任何前端文件
- [ ] `data/` 已做定时备份，并且验证过一次恢复
- [ ] 域名、SEO 默认值、默认分享图都已经改成自己的

## 七、首页照片与字体

- 首页那排「晒晒」照片取自媒体库里最新的 12 张图片。要换：后台 → 媒体 → 上传 / 删除。
- 项目自带 12 张样片（`public/static/home/`），`npm run reset` 时会把它们装进媒体库。
  换成自己的照片后，把这个目录清空，`reset` 就不会再放样片了。
- 中文字体（思源宋体 + 楷体子集）在 `public/static/fonts/`，会跟着项目一起部署。
  字体栈里**故意不写 SimSun**：宋体在部分渲染环境下会把中文画成空白。
- 全站前端资源都在 `public/assets/`，由 `npm run build` 生成；页面用文件时间戳做版本号，
  改完样式重新构建就会自动刷新缓存。

## 八、当前使用的豆包（方舟）配置

已经配好并验证可用（写在 `.env` 里，不在仓库、不在前端）：

```
IMAGE_PROVIDER=doubao
ARK_MODEL=doubao-seedream-4-0-250828
ARK_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/images/generations
IMAGE_SIZE=2048x1152
```

- 提示：`doubao-seedream-3-0-t2i-250415` 这类旧模型 ID 在这个账号下会报 404
  `InvalidEndpointOrModel.NotFound`——换一个账号已开通的模型 ID，或用控制台里的接入点 ID（`ep-…`）。
- 命令行重生基础视觉（不用进后台）：

  ```bash
  node scripts/gen-visuals.mjs bloom --count 3 --take 1   # 生成 3 张候选并采用第 1 张
  node scripts/gen-visuals.mjs ink --count 2 --take 1
  node scripts/gen-visuals.mjs bloom --prompt "自己写描述"
  ```

- 后台「视觉」里的“生成 3 张候选”会真的请求 3 次（方舟一次只返回一张图）。
- 密钥在对话里贴过一次就相当于泄露过一次，建议找时间去控制台轮换，然后只更新 `.env` 里的这一行。

## 九、手机上怎么看（同一局域网）

`.env` 里已经设了 `HOST=0.0.0.0`，同一 WiFi 下的手机、平板就能直接打开：

| 设备 | 地址 |
| --- | --- |
| 自己电脑 | 前台 <http://127.0.0.1:8787/> · 后台 <http://127.0.0.1:8787/admin> |
| 手机（同一 WiFi） | 前台 <http://192.168.31.188:8787/> · 后台 <http://192.168.31.188:8787/admin> |

几个提醒：

- 路由器重启后 IP 可能会变：在电脑上跑 `ipconfig`，看“IPv4 地址”那一行。
- 第一次可能弹 Windows 防火墙，选**允许（专用网络）**；手机打不开就去
  「Windows Defender 防火墙 → 允许应用通过防火墙」把 Node.js 勾上。
- 同一 WiFi 下的人都能打开后台登录页（没密码进不去），所以请设一个强密码。
- 出门在外想看，就得走第十一节的公网部署。

## 十、怎么上传照片 / 视频 / 录音

手机和电脑都能传，三条路：

1. **写文章时**：工具栏「图片 / 视频 / 音频」——手机上直接调出**相册 / 拍照 / 录像**；电脑上是文件选择框。
2. **粘贴 / 拖拽**（电脑）：把图片拖进编辑器，或截图后 `Ctrl+V`，自动上传并插到光标处。
3. **单独进媒体库**：后台 → 媒体 → 选择文件（手机）/ 拖进来（电脑）。

上传后自动：安全文件名 → 读尺寸 → 生成 WebP 优化版与缩略图。
首页那排小照片 = 媒体库里**最新的 12 张**；每张下面的字在
后台 → 媒体 → 点一张 → caption 里改。

> 单个文件默认上限 200MB（可在 `.env` 改 `MAX_UPLOAD_MB`，同时把 Nginx 的 `client_max_body_size` 调大）。

## 十一、从 zhangzhongwei.top 搬内容（已完成）

已用脚本把旧站 **60 篇文章 + 54 个媒体文件**（图片/录音/视频）搬进来，全部落在**归心（日志）**：

```bash
node scripts/import-hugo.mjs "D:/work/codex/project1/content" --section log --wipe
```

- `--section log` 指定落在哪一栏（也可用 origin / self / bloom）
- `--wipe` 先清掉演示文章（保留组件测试那篇）；不加就是追加
- 重复 slug 自动跳过，可以反复跑
- 旧站的 `{{< audio >}}` `{{< video >}}` `{{< note >}}` 会自动换成新站的 Markdown
- 想单独调某篇的栏目，在后台文章列表里改即可

## 十二、把域名接上（正式上线）

要对外上线，需要一台带公网 IP 的小服务器（轻量 1核2G 够用）：

1. 服务器上装 Node 22+，把整个项目传上去（**`data/` 目录必须一起传**，里面是文章和媒体）。
2. 服务器上执行 `npm install && npm run build`（**不要**跑 `npm run reset`，会清掉内容）。
3. 用 systemd 常驻（见第三节示例），`.env` 改 `HOST=127.0.0.1`、`COOKIE_SECURE=1`。
4. Nginx 反代到 `127.0.0.1:8787`（见第三节片段），`client_max_body_size` 按视频大小调。
5. 域名服务商那里加 A 记录：`zhangzhongwei.top` → 服务器公网 IP；`www` 用 CNAME 指向主域名。
6. 用 certbot 一行命令签 HTTPS，然后把 `COOKIE_SECURE=1` 打开并重启。
7. 后台 → 设置 → 域名改成真实域名，再在后台重建一次搜索索引。

> 旧站（GitHub Pages 上的 Hugo）先不要动，两边可以同时存在，等新站跑稳了再切 DNS。
