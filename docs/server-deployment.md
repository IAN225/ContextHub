# Ubuntu 服务器与 HTTPS 配置

本版新增 `pnpm server` 和 `/server` 管理页，适合单人 Ubuntu 服务器试用。网页支持设置管理员密码、启用域名、验证 HTTPS 和查看证书状态。入口位于书架头像弹窗中的“服务器访问与 HTTPS 设置”。普通 `pnpm start` 和临时 OAuth 隧道保持原来的运行方式。

**当前进度：本地实现与自动测试已完成；Ubuntu、真实证书签发/续期、重启后的进程守护及腾讯云上的 Claude/ChatGPT OAuth 尚待实机验收。** 本版仍通过 Wrangler dev / Workerd 的本地持久化运行应用，并未替换成经过生产部署验证的运行时。

## 访问方式

| 条件 | 前端选择 | 需要先准备什么 |
| --- | --- | --- |
| 自有域名，或能控制 DNS 的免费子域名 | 自动申请与续期证书 | 域名 A/AAAA 指向服务器、80/443 公网可达、专用 Caddy 实例 |
| 云平台、隧道或已有反向代理提供稳定 HTTPS URL | 已有 HTTPS 入口 | 公网有效证书、原域名及 HTTPS 协议标记保留、转发到本机 4080 |
| 只有公网 IP，完全没有域名或服务商地址 | 暂不支持自动设置 | 先取得可控制的子域名，或使用提供稳定 URL 的 HTTPS 服务 |

无需购买顶级域名，但项目不会代注册免费域名，也不会自动创建隧道账号。自动模式需要实际控制 DNS；已有 URL 必须确实指向此服务，不能填写任意第三方网址。地址只接受标准 443 端口、无路径的 HTTPS 域名。公网 IP 证书、DNS API 自动配置、证书文件上传、通配符证书暂未接入。

## 入口与边界

```text
浏览器 / 客户端 → HTTPS :443 → Caddy 或外部反向代理
                               ↓
                        127.0.0.1:4080 服务器入口
                         ├─ 页面与管理 API：管理员登录
                         ├─ MCP / OAuth：既有网关 :3001 → 原应用 :3000
                         └─ /v1 投递：原应用独立的访问令牌验证

SSH 本地端口转发 → 127.0.0.1:4310/server → 首次设置 / 维护入口
```

- 3000、3001、4080、4310 全部绑定服务器 loopback；Caddy 管理 API 2019 也只绑定 loopback。腾讯云轻量防火墙与系统防火墙只需开放 SSH、TCP 80/443，不要开放这些内部端口。
- 首次管理员设置只允许从 SSH 转发的 4310 入口提交；之后可用 HTTPS 登录。密码以 scrypt 派生值保存，会话令牌仅保存哈希，12 小时到期，支持退出和登录尝试限流。公网 cookie 使用 Secure / HttpOnly / SameSite；本机和公网会话分别验证。
- 这是整台服务的单管理员入口，不是云端账号、团队权限或工作区多用户隔离。主机上的其他本地进程仍处于信任边界内；不要与不可信用户共用这台主机。
- 代理保留既有 MCP 授权链路；网页管理请求先验证管理员和真实浏览器来源，再转发给只接受 loopback 的应用。外部代理不得直接转发到 3000，否则会绕过新增登录入口。

## 首次安装

以下以专用 Ubuntu 服务器为例；已有站点请用“已有 HTTPS 入口”，不要接管它们的 Caddy 实例。先安装 Node.js 22.13+、pnpm、Git；模板默认 Node 在 `/usr/bin/node`，安装位置不同须调整 `ExecStart`。源码放在 `/opt/contexthub`，从仓库根目录开始。

```sh
sudo useradd --system --create-home --home-dir /var/lib/contexthub --shell /usr/sbin/nologin contexthub
sudo install -d -o contexthub -g contexthub -m 700 /opt/contexthub/demo/.wrangler
cd /opt/contexthub/demo
pnpm install --frozen-lockfile
pnpm build
sudo -u contexthub env HOME=/var/lib/contexthub pnpm db:init
```

源码和依赖应可被 `contexthub` 读取，`.wrangler` 应由它写入。安装依赖所需的构建脚本按项目与包管理器提示审核；不要复制 Windows 的 `node_modules` 或 `dist` 到 Ubuntu。迁移命令应使用服务账号执行，避免数据库被 root 占有。`pnpm` 必须可由服务账号找到，若安装在个人 home 下，应改用其可访问的安装位置。

自动 HTTPS 模式按 [Caddy 官方 Ubuntu 安装说明](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) 安装。项目使用 API 管理整份 Caddy 配置，因此采用官方 `caddy-api.service` 的持久配置恢复方式；参见 [Caddy 服务运行说明](https://caddyserver.com/docs/running)。以下操作仅用于没有其他 Caddy 站点的专用实例：

```sh
cd /opt/contexthub
sudo install -m 644 deploy/ubuntu/caddy-bootstrap.json /etc/caddy/contexthub-bootstrap.json
sudo install -d /etc/systemd/system/caddy-api.service.d
sudo install -m 644 deploy/ubuntu/caddy-api-override.conf /etc/systemd/system/caddy-api.service.d/contexthub.conf
sudo systemctl disable --now caddy
sudo systemctl daemon-reload
sudo systemctl enable --now caddy-api
```

首次无配置时只启动本机管理 API；前端提交域名后才开启 HTTPS。Caddy 通过自身存储保留证书与配置，重启使用 `--resume` 恢复。不要用初始空配置反复 reload，也不要让其他应用调用本机 2019 API 覆盖此实例。

已有 HTTPS 模式跳过上述专用 Caddy 配置，由原代理维护证书。在原 HTTPS 虚拟主机内，转发到 `http://127.0.0.1:4080`，保留原 `Host`，并由代理设置 `X-Forwarded-Proto: https`。关闭代理对 MCP/SSE 的响应缓冲，并提供足够的长连接超时。代理必须运行在同机或通过受控的本机转发接入；本版没有开放 4080 的远程监听。

最后安装应用服务：

```sh
cd /opt/contexthub
sudo install -m 644 deploy/ubuntu/contexthub.service /etc/systemd/system/contexthub.service
sudo systemctl daemon-reload
sudo systemctl enable --now contexthub
sudo systemctl status contexthub
```

系统服务以非 root 身份运行，自动拉起失败进程。设置页面不会执行 sudo、编辑系统服务或接收 SSH 私钥。首次安装仍需一次 SSH 部署。

## 页面操作

在自己的电脑建立 SSH 转发，替换成自己的 SSH Host 别名或用户名/服务器地址：

```sh
ssh -N -L 127.0.0.1:4310:127.0.0.1:4310 your-server
```

打开 `http://127.0.0.1:4310/server`，设置至少 12 字符的管理员密码。选择模式，填写域名；自动模式还需阅读并同意证书机构订户协议。点击“检查并开启 HTTPS”后，页面展示配置进度和具体失败反馈。

服务首先检查 DNS 全部解析结果均为公网地址。自动模式保留旧域名配置并让 Caddy 申请新证书，然后通过正常信任校验的 HTTPS 请求验证一次性随机码，确认 URL 到达当前实例。只有验证通过才重启应用以启用新 OAuth origin、保存新地址。验证或重启失败会尝试恢复旧配置，并显示恢复失败时的维护提示。探测会固定到已验证的 DNS 地址、不跟随重定向；私有地址不能作为检查目标。

证书申请不一定在一次等待窗口内完成。若 DNS、端口和 Caddy 日志正常，可稍后再试；不要频繁反复申请。Caddy 的配置接口支持事务性加载，但真实证书签发及外部网络可用性仍由后续探测判断，参见 [Caddy API](https://caddyserver.com/docs/api)。

验证成功后打开显示的 HTTPS 地址并登录。地址更换期间建议保留 SSH 维护页；旧地址完成切换后会停止接收管理请求。**换地址前先导出浏览器手账备份，新地址下需导入备份、重新配置 MCP 客户端并授权。** 本机与域名的 IndexedDB 是不同存储，新增管理员登录不会自动迁移或同步它们。自动证书改为同域名外部代理的迁移需通过 SSH 完成，本版不允许在网页直接切换并关闭现有证书入口。

连接状态显示证书颁发者、到期时间和最近验证时间，并每 30 分钟由服务复查；“检查连接”可手动复查。自动模式由 Caddy 续期，已有 HTTPS 模式由外部服务续期。这里显示的是最近成功观测到的证书，失败时保留旧信息并显示错误，不代表证书始终有效。

## 持久化、维护与现有缺口

- `demo/.wrangler/state`：原应用数据库、任务、MCP 授权、服务器副本与附件；`demo/.wrangler/server/access.json`：管理员密码派生值、会话哈希、稳定网关密钥与已生效地址。`runtime.env` 由启动器生成，全部被 Git 忽略。`CONTEXT_HUB_SERVER_DATA_DIR` 只改变管理状态目录，不改变原应用数据目录。
- 浏览器手账备份和上述服务端数据都需保留；停服务后再做文件备份。Caddy 默认服务账号的数据位于 `/var/lib/caddy`，包含证书私钥，应作为受限备份处理。
- 更新时先备份并停止 `contexthub`，以部署账号更新依赖、构建，以服务账号运行迁移，再启动。暂不支持不停机版本切换。`pnpm start`、`pnpm mcp:oauth` 与 `pnpm server` 不应同时占用同一套端口和数据。
- 查看应用日志：`sudo journalctl -u contexthub -n 100 --no-pager`；自动证书日志：`sudo journalctl -u caddy-api -n 100 --no-pager`。配置过程中可能短暂中断应用连接；日志中的授权网址、请求码和密钥不能当作公开故障报告上传。
- 密码修改、忘记密码恢复、多因素认证、远程通知、自动备份和跨设备同步尚未实现；不要通过删除整个 `.wrangler` 来重置密码或修复连接。
- 服务启动模板和应用子进程退出处理已提供，但尚未实测 Ubuntu systemd 权限、真实重启与证书续期。下一步在腾讯云检查端口、签发、服务重启后数据与授权保留，再分别验证 ChatGPT/Claude OAuth 和 Note 写入。

## 本地验证方式

```sh
cd demo
pnpm test
pnpm typecheck
pnpm build
```

新增 `tests/server-access.test.mjs` 使用临时目录和随机本机端口，测试密码/会话持久化、登录限制、代理隔离、配置提交时机、回滚、已有代理模式、DNS/HTTPS 探测与 Caddy 配置生成。测试中的证书机构和应用重启为受控替身，不会申请真实证书，也不会启动或改动正在使用的 MCP 隧道。

本轮 132 项回归测试、类型检查、应用静态检查和隔离构建通过。构建后另执行 `node --experimental-strip-types --import ./scripts/local-runtime.mjs tests/server-access-http.mjs`，通过真实 Workerd / D1 验证新页面及静态资源、管理登录、OAuth 发现、MCP 网关 Note 创建/读取及投递鉴权；使用独立临时数据，不代替浏览器交互或公网证书验收。
