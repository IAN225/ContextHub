# Context Hub

自托管的对话、Note、摘要和记忆仓库。所有已保存内容、附件、草稿、模型配置与 MCP 授权均按账号保存。管理员可以管理注册审批、用户角色和 HTTPS 证书。

## 源码部署

支持 Ubuntu 22.04 及以上版本。将域名解析到服务器，开放 TCP 22、80、443，然后执行：

```bash
git clone https://github.com/IAN225/ContextHub.git
cd ContextHub
sudo bash deploy/install.sh --domain hub.example.com --accept-acme-terms
```

安装脚本自动安装 Node.js 24、pnpm、Python 和 Caddy，构建应用、初始化数据库并设置开机自启。使用自动证书前请阅读 [Let's Encrypt 订户协议](https://letsencrypt.org/repository/)。

初始用户名为 admin，密码随机生成：

```bash
sudo cat /opt/contexthub/app/.wrangler/server/initial-admin-password.txt
```

打开你的 HTTPS 域名登录，必须先修改初始密码才能激活。完成后使用新密码重新登录；初始密码文件会删除。新用户提交注册申请后，需要管理员审批。首页和手账页的“管理员设置”提供审批、关闭注册、角色与证书管理。

没有准备域名时，可先运行 sudo bash deploy/install.sh，使用 SSH 隧道激活，再配置 HTTPS：

```bash
ssh -N -L 4310:127.0.0.1:4310 ubuntu@server
# 浏览器打开 http://127.0.0.1:4310/login
```

## Docker 部署

服务器需要 Docker Engine 和 Compose v2。在仓库根目录：

```bash
cp .env.example .env
# 编辑 .env，填写域名并确认 CONTEXT_HUB_ACCEPT_ACME_TERMS=true
bash deploy/docker.sh
docker compose exec app cat .wrangler/server/initial-admin-password.txt
```

应用、证书与 Caddy 配置存入持久卷；本机设置端口只绑定 127.0.0.1。源码部署与 Docker 部署二选一，避免占用相同端口。

## 使用

- 创建手账后，可写入或导入对话、Note，维护摘要和记忆包。
- 摘要功能需要在模型设置中配置你自己的模型地址、名称与 API Key；任务在服务器后台执行。
- 手账“连接”页提供正式 MCP / OAuth 配置，可授权 Claude、ChatGPT 等客户端访问该手账。
- 换浏览器或设备后使用同一账号登录，即可读取已保存内容。多设备同时修改可能触发版本冲突，按页面提示刷新处理。
- 已下载附件跟随账号保存；尚未下载的外部附件仍依赖原地址。当前单个附件上限 5 MB。

## 仓库结构

```text
app/                 应用源码、数据库迁移与运行脚本
  app/               页面与 API 路由
  components/        按业务模块拆分的前端组件
  lib/               领域逻辑、账号存储、MCP 与后台任务
  scripts/           账号网关、内部应用进程与运维命令
  drizzle/           数据库迁移
deploy/              源码、Docker 部署及备份恢复工具
docs/operations.md   日常运维说明
Dockerfile
compose.yaml
```

构建配置和依赖锁文件随源码提供；仓库不包含演示页面、开发过程记录、测试数据、账号数据库或凭据。运行方式统一为账号服务：在 app/ 执行 pnpm build、pnpm db:init 后，pnpm start 启动服务。正式部署优先使用安装脚本。

[升级、日志、密码重置与备份恢复](docs/operations.md)。
