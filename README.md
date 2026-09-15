# Context Hub

自托管的对话、Note、摘要和记忆仓库。内容、附件、草稿、偏好、模型配置与授权按账号保存。管理员可以审批注册、管理用户角色和 HTTPS。

桌宠可在“设置 → 偏好 → 桌宠”导入 ZIP 角色包，详见 [角色包格式与制作说明](docs/pet-packs.md)。

## Quickstart：源码部署

支持 Ubuntu 22.04 及以上版本，建议至少 2 核、4 GB 内存。无需域名，先开放服务器防火墙和云防火墙的 TCP 8080 端口（SSH 使用 TCP 22）：

```bash
git clone https://github.com/IAN225/ContextHub.git
cd ContextHub
sudo bash deploy/install.sh
```

脚本安装 Node.js 24、pnpm、Python 和 Caddy，构建应用、初始化数据库并设置开机自启。完成后访问 `http://服务器IP:8080`；在部署这台电脑上也可以使用 `http://localhost:8080`。`0.0.0.0` 是监听地址，不是需要输入浏览器的地址。

控制台末尾会列出检测到的访问地址、管理员用户名 `admin` 和查看当前密码的命令：

```bash
sudo cat /opt/contexthub/app/.wrangler/server/admin-password.txt
```

首次管理员登录即激活，进入管理员页后可选择“保留当前密码”或设置新密码。改密无需再次输入当前密码。内置 `admin` 的当前密码始终保存在上述文件中，改密后自动更新；新用户注册仍需要管理员审批。

HTTP 不加密密码和内容。网页功能可以先通过 HTTP 使用；**MCP 必须配置 HTTPS 域名后才能启用**。在“管理员设置 → HTTPS”中填写域名，或首次部署时直接传入：

```bash
# 更换 HTTP 网页端口
sudo bash deploy/install.sh --port 8088

# 首次部署时同时配置 HTTPS；域名须已解析到服务器，并开放 TCP 80、443
sudo bash deploy/install.sh --domain hub.example.com --accept-acme-terms

# 使用已有的 HTTPS 反向代理
sudo bash deploy/install.sh --domain hub.example.com --external-https
```

自动证书需要先阅读 [Let's Encrypt 订户协议](https://letsencrypt.org/repository/)。外部代理应转发到 `127.0.0.1:4080`，保留 `Host`，设置 `X-Forwarded-Proto: https`。配置 HTTPS 后网页仍可通过 IP 和 HTTP 端口访问；MCP 连接地址始终使用配置的 HTTPS 域名。

### 源码部署参数

参数可以组合使用，`sudo bash deploy/install.sh --help` 可查看帮助。

| 参数                            | 默认值与作用                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--port 8088`                   | HTTP 网页端口，首次默认 `8080`。可用范围 `1024–65535`，排除内部端口 `3000`、`3001`、`4080`、`4310`。保存后升级时不传该参数会沿用原端口。 |
| `--domain hub.example.com`      | 可选 HTTPS 域名，不带协议、端口和路径；无域名也可部署。仅用于初始化，已有域名在管理员页面修改。                                          |
| `--accept-acme-terms`           | 同意自动证书订户协议；与首次配置的自动 HTTPS 域名一起使用。                                                                              |
| `--external-https`              | 使用已有的 HTTPS 代理，不由安装脚本管理 Caddy。后续升级继续传入此参数。                                                                  |
| `--prefix /opt/contexthub-test` | 安装前缀，默认 `/opt/contexthub`；允许该路径或带小写字母、数字、短横线的后缀。升级沿用原值。                                             |
| `--service contexthub-test`     | systemd 服务名，默认 `contexthub`，允许相同规则的后缀。升级沿用原值。                                                                    |
| `--skip-dependencies`           | 跳过系统依赖安装，适用于依赖已就绪的升级。                                                                                               |
| `--no-start`                    | 安装并初始化后不启动服务；仅限首次安装。输出地址会注明服务尚未启动。                                                                     |
| `--help`                        | 输出参数帮助。                                                                                                                           |

自定义 prefix/service 不会自动隔离内部端口；同机只运行一个实例。修改 HTTP 端口时记得同步调整防火墙。

## Quickstart：Docker 部署

Linux 服务器需先安装 Docker Engine、Compose v2 和 Python 3。开放 TCP 8080；启用 HTTPS 时再开放 TCP 80、443。在仓库根目录执行：

```bash
git clone https://github.com/IAN225/ContextHub.git
cd ContextHub
cp .env.example .env
# 可直接保留默认值；需要自定义端口或域名时编辑 .env
sudo bash deploy/docker.sh
```

完成后访问 `http://服务器IP:8080`。控制台同样会输出地址和密码查看方法（在仓库根目录运行）：

```bash
sudo docker compose exec app cat .wrangler/server/admin-password.txt
```

Docker 部署脚本不接受源码脚本的 CLI 参数，启动配置写在 `.env` 中并在升级时保留：

| 变量                            | 默认值与作用                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| `CONTEXT_HUB_PORT`              | `8080`，宿主机 HTTP 网页端口；容器内固定为 `8080`。                    |
| `CONTEXT_HUB_DOMAIN`            | 留空；填写域名可在首次启动时初始化 HTTPS。                             |
| `CONTEXT_HUB_HTTPS_MODE`        | `automatic` 自动证书；`external` 使用已有 HTTPS 代理。                 |
| `CONTEXT_HUB_ACCEPT_ACME_TERMS` | `false`；自动证书配置域名时设置为 `true`。                             |
| `CONTEXT_HUB_SETUP_PORT`        | `4310`，仅绑定宿主机 `127.0.0.1` 的维护端口。                          |
| `CONTEXT_HUB_HTTP_BIND`         | `0.0.0.0:80`，Caddy 的 HTTP 绑定。                                     |
| `CONTEXT_HUB_HTTPS_BIND`        | `0.0.0.0:443`，Caddy 的 HTTPS 绑定。正式 HTTPS 入口使用标准 443 端口。 |

外部 HTTPS 代理需要与应用共享可访问 `4080` 的网络；Compose 默认不把内部端口暴露到公网。源码与 Docker 部署二选一，避免端口冲突。应用和证书存入持久卷；升级不要删除 `.env` 或持久卷。

部署输出中的公网 IP 来自一次限时地址查询，失败时仍会列出本机地址，不影响部署。云 NAT、代理或家用路由器环境下，以云控制台的公网 IP 或你配置的端口转发为准。密码不会直接打印到日志。内置 `admin` 的恢复文件权限为 600，仅服务器文件系统授权用户可读；普通用户及其他管理员不保存明文密码副本。管理员密码错误时，登录页提示查看该文件的方法，网页接口不会返回密码。

## 使用

- 创建工作区后，可写入或导入对话、Note，维护摘要和记忆包。
- 客户端投递预览默认排除末尾尚无回复的纯文本用户消息（通常用于触发投递）；可勾选“保留最后一条用户消息”恢复。原收件在归档前保持完整，分享链接、手动导入和带附件的末尾消息不使用该默认排除。
- 收件箱按窗口可用高度显示，邮件标题和归档栏固定，长对话在邮件内部滚动。
- 摘要页可切换“自定义压缩”和“ReMeLight 风格（实验）”；两套配置、模型连接、摘要历史和处理进度独立，任务在服务器后台逐个执行。实验方案是参考 ReMeLight 的 TypeScript 实现，不包含官方 Python 引擎。详见 [摘要方案](docs/summary-engines.md)。
- 两套方案分别配置模型地址、名称和 API Key。查看页签不会更改记忆注入来源；用“设为记忆注入来源”或在记忆包页明确选择。
- 配置 HTTPS 后，工作区“连接”页可授权 Claude、ChatGPT 等 MCP 客户端访问当前工作区。
- 换设备后用同一账号读取已保存内容；同时修改同一记录会触发冲突保护。
- 已下载附件按账号保存；未下载的外部附件仍依赖原地址，单个附件上限 5 MB。

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

仓库仅提供源码及构建配置，不包含数据库或凭据。手动运行时，在 `app/` 执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm db:init`，最后 `pnpm start`。启动进程可通过环境变量 `CONTEXT_HUB_PORT` 覆盖网页端口；首次初始化还支持 `CONTEXT_HUB_DOMAIN`、`CONTEXT_HUB_HTTPS_MODE`、`CONTEXT_HUB_ACCEPT_ACME_TERMS`。直接用 `pnpm start` 不会安装 Caddy 或系统服务，正式部署请用上述脚本。

[升级、日志、密码重置与备份恢复](docs/operations.md)。
