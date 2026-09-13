# Context Hub · 对话手账

自托管的对话、Note、摘要与跨窗口记忆仓库。手账、附件、草稿、模型配置和 MCP 授权跟随账号保存。支持 Claude / ChatGPT 的 OAuth 连接与 7 个 MCP 工具。

## 源码部署

在 Ubuntu / Debian 服务器检出源码，在仓库根目录执行：

```bash
sudo bash deploy/install.sh --domain hub.example.com --accept-acme-terms
sudo cat /opt/contexthub/demo/.wrangler/server/initial-admin-password.txt
```

提前解析域名并开放 80、443；使用自动证书前阅读 [Let's Encrypt 订户协议](https://letsencrypt.org/repository/)。无域名时可先省略两个参数，通过 SSH 转发的本机入口激活，再设置 HTTPS。

## Docker 部署

```bash
cp .env.example .env
# 编辑域名及证书协议确认选项
bash deploy/docker.sh
docker compose exec app cat .wrangler/server/initial-admin-password.txt
```

初始用户名 admin，密码随机生成。管理员首次登录必须修改密码，完成后实例才激活。普通用户提交注册申请，管理员审批后才能登录；管理员可关闭注册或调整其他已批准用户的角色。

完整步骤、升级和备份见 [部署与激活指南](docs/deployment-and-activation.md)。已有账号版升级会保留数据与原密码，并要求初始管理员完成一次改密激活。

## 功能与开发

实际应用代码位于 demo/（历史目录名），部署使用同一份代码。已经实现和未实现的能力见 [功能审查](docs/feature-audit.md)，数据库说明见 [云端账号设计](docs/cloud-accounts.md)。

Node.js 24 与 pnpm 用于开发：

```bash
cd demo
pnpm install --frozen-lockfile
pnpm build
pnpm db:init
pnpm start
```

pnpm start / pnpm dev 是保留的单机模式，数据存于当前浏览器；pnpm server 是带账号和激活限制的服务器模式，首次无域名可通过 127.0.0.1:4310 登录。完整自托管优先使用上面的部署入口。

更多说明：[导入](docs/conversation-imports.md)、[摘要](docs/summary-compression.md)、[MCP](docs/mcp.md)、[前端样式](docs/frontend-styles.md)、[接续记录](docs/HANDOFF.md)。

仓库只同步代码；数据库、初始密码、API Key、附件和运行状态不应提交 Git。浏览器 JSON 备份不包含模型 API Key，完整备份应包含服务器数据库与证书状态。
