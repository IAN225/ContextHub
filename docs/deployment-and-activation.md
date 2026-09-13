# 部署、首次激活与用户管理

## 从源码部署（Ubuntu / Debian）

在服务器检出需要部署的版本后，在仓库根目录执行：

```bash
sudo bash deploy/install.sh --domain hub.example.com --accept-acme-terms
```

先把域名解析到服务器，并放通 TCP 80、443。自动证书使用 Let's Encrypt；运行带该参数的命令前，阅读[订户协议](https://letsencrypt.org/repository/)。脚本安装 Node.js 24、pnpm 和 Caddy，以独立 contexthub 用户构建、迁移和启动应用，安装开机自启服务。Node 下载会核对官方 SHA256 文件。

没有准备域名时可省略两个参数。通过 SSH 转发访问本机登录页，完成激活后在“服务器管理”设置 HTTPS：

```bash
ssh -N -L 4310:127.0.0.1:4310 ubuntu@server
# 浏览器打开 http://127.0.0.1:4310/login
```

初始用户名是 admin，密码随机生成，只保存在权限受限的文件中：

```bash
sudo cat /opt/contexthub/demo/.wrangler/server/initial-admin-password.txt
```

已有同机 HTTPS 代理可使用 --external-https；代理转发至 127.0.0.1:4080，保留 Host 并设置 X-Forwarded-Proto: https。使用已有代理时填写它实际服务的域名。脚本不会覆盖无关 Caddy 站点。

其他参数：

- --skip-dependencies：已具备 Node.js 24、pnpm、rsync 和相应 HTTPS 服务时跳过安装依赖。
- --prefix /opt/contexthub-test --service contexthub-test --no-start：构建、迁移和初始化一个独立目录，但不启动它。多个源码实例不能同时占用相同默认端口。
- --help：查看参数。

## Docker Compose

需要 Linux 容器和 Docker Compose v2。在仓库根目录：

```bash
cp .env.example .env
# 编辑 .env：填写 CONTEXT_HUB_DOMAIN，并确认 CONTEXT_HUB_ACCEPT_ACME_TERMS=true
bash deploy/docker.sh
docker compose ps
docker compose exec app cat .wrangler/server/initial-admin-password.txt
```

也可直接运行 docker compose up -d --build。应用以非 root 用户运行；Caddy 提供 HTTPS 和证书续期。应用共享 Caddy 的网络空间，内部数据库、应用及 Caddy 管理端口不直接对公网发布；本机设置入口只映射到宿主机 127.0.0.1:4310。

三个持久卷分别保存应用数据库、Caddy 证书与 Caddy 配置。停止或重建容器会保留数据；docker compose down -v 会删除数据卷，不能用作升级命令。

Docker 的启动顺序、网络共享和卷定义遵循 [Compose 服务规范](https://docs.docker.com/reference/compose-file/services/)；Caddy 安装和服务方式见[官方说明](https://caddyserver.com/docs/install)。

## 激活规则

1. 空实例生成随机初始管理员密码；重复启动不会重置它。
2. admin 登录后只能进入改密激活页面。普通业务 API、手账、MCP、投递和管理功能由服务器统一拦截。
3. 新密码至少 12 个字符，且必须不同于当前密码。改密成功后，实例持久化为已激活，撤销旧网页登录会话，并删除初始密码文件。
4. 使用新密码重新登录后，手账和管理员页面可正常使用。

已部署旧账号版升级时，保留所有云端内容、账号、授权、证书及已有密码。首次升级要求初始管理员用原密码登录并完成一次改密激活，不会给已有账号随机覆盖密码。完成后再次部署不重复要求激活。

## 注册与审批

- 实例激活后默认开放注册申请。登录页提供“申请账号”入口。
- 新账号固定为普通用户且处于待审批状态，不能登录或访问数据；提交 role、status 等额外字段不能自行升级权限。
- 管理员在“我的账号 → 用户与注册管理”批准或拒绝申请。拒绝后的申请不可登录，用户名仍保留。
- 管理员可以关闭或重新开放注册。关闭仅阻止新申请，既有账号和待处理申请不受影响。
- 管理员可将已批准用户设为管理员，也可降为普通用户。权限在后续请求中立即重新核验；系统始终保留至少一名管理员。
- 多个管理员同时操作时，过期的管理页面提交会被拒绝，刷新列表后重试。

无需邮箱服务。本版不包含邮件通知、邮箱找回、多因素认证、删除账号或团队共享。忘记密码仍通过服务器 CLI 重置；CLI 是具有服务器访问权限的运维入口，可直接创建账号，网页注册必须审批。

## 更新与备份

源码更新：检出新版本后重新执行相同安装命令。脚本先构建，再停止服务，备份 .wrangler 到 /var/backups/contexthub，保留状态、应用迁移并重启；不会清空旧数据。升级不是不停机发布。若迁移或启动失败，根据日志和备份处理，不要删除数据库。

Docker 更新：

```bash
# 先完成数据库与证书卷备份，再检出新版本
docker compose up -d --build --force-recreate
```

备份时停止应用写入。应用 .wrangler/server/accounts.sqlite 及其 WAL、.wrangler/state、access.json 和两份 Caddy 持久卷共同构成完整备份。不要将运行中的 SQLite 主文件单独复制后视为完整备份。

## 数据库扩展

users 增加 status（pending / active / rejected）与 must_change_password；instance_settings 保存 deployed、activated_at、registration_open 与管理版本号 revision。升级事务补齐字段，保留原账号记录。审批和角色变更在 SQLite 事务中核验当前管理员身份、目标状态及最新版本；密码哈希仍使用 scrypt，会话只保存令牌哈希。
