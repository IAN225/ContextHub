# ContextHub

ContextHub 是一个可部署在云端托管的 AI 对话与记忆工作区。你可以从不同客户端将claude、gpt、deepseek或其他模型的对话导入工作区，把长对话整理成摘要和 Note，再通过 MCP 让新的对话读取这些上下文。

一个工作区对应一组相关内容，例如一个项目、一段长期对话或一个创作主题。内容保存在你部署的服务器上，登录同一账号即可跨设备使用。

## 可以做什么

- **整理对话**：导入已有对话、接收客户端投递，按轮次查看原文和附件。
- **Note**：MCP 客户端模型和用户都可以创建、搜索、修改，支持编辑历史与标星。
- **压缩上下文**：配置模型服务分批生成摘要，或让已连接 MCP 的对话模型下载原文、自行压缩并提交摘要。
- **编排记忆包**：组合摘要、原文、Note 和自定义内容，供 MCP 客户端读取。
- **个性化外观**：设置工作区主题和模型头像，导入自己的桌宠角色包（兼容codex格式）。

摘要提供“自定义压缩”“ReMeLight 风格（实验）”和“客户端压缩”三种独立方案。前两种自行配置模型 API；客户端压缩由 MCP 连接的对话模型完成，无需在 ContextHub 配置摘要模型。实验方案参考 ReMeLight，不包含其官方 Python 引擎。模型使用费用由相应服务收取。详见[摘要方案与 MCP 压缩流程](docs/summary-engines.md)。

## Quickstart

选择源码或 Docker 部署其中一种。**没有域名也可以使用网页其他功能；连接 MCP 客户端需要在启动项中指定指向本服务器的 HTTPS 域名或后续在网页中设置后启用。**

### 方式一：源码部署

准备一台 Ubuntu 22.04 或更新版本的服务器、具有 sudo 权限的账号，以及 Git。可从 2 核、4 GB 内存的配置开始；长对话和大量附件的资源需求会更高。服务器需要能够下载 GitHub 源码及安装依赖。

在服务器和云平台防火墙放行 TCP **8080**，保留用于远程管理的 SSH 端口，然后执行：

```bash
git clone https://github.com/IAN225/ContextHub.git
cd ContextHub
sudo bash deploy/install.sh
```

脚本会安装运行依赖、构建应用、创建数据库，并设置服务开机自启。完成后访问：

```text
http://服务器IP:8080
```

安装结果会列出访问地址和查看管理员密码的方法。默认管理员用户名为 `admin`，密码随机生成，在服务器执行以下命令查看：

```bash
sudo cat /opt/contexthub/app/.wrangler/server/admin-password.txt
```

### 方式二：Docker 部署

准备一台装有 Git、Docker Engine、Compose v2 和 Python 3.10+ 的 Linux 服务器，并放行 TCP **8080**。

```bash
git clone https://github.com/IAN225/ContextHub.git
cd ContextHub
cp .env.example .env
sudo bash deploy/docker.sh
```

默认访问地址同样是 `http://服务器IP:8080`。用户名为 `admin`，在仓库目录查看随机生成的密码：

```bash
sudo docker compose exec app cat .wrangler/server/admin-password.txt
```

应用数据和证书使用持久卷保存；更新时保留 `.env` 和这些卷。

### 首次使用

1. 使用 `admin` 登录以激活实例。在设置页选择保留初始密码或设置新密码。
2. 回到首页创建工作区，导入对话或新建 Note。
3. 需要生成摘要时，在工作区“摘要”中选择方案，配置模型地址、模型名称和 API Key。
4. 需要连接 AI 客户端时，先完成下方 HTTPS 配置，再到工作区“连接”中创建授权，按页面指引配置客户端。MCP（模型上下文协议）使客户端能读取记忆、检索内容和操作 Note。

新用户注册后需要管理员批准。管理员可在首页“设置”中审批申请、关闭注册入口或调整用户角色；个人偏好也在这里设置。

## 域名与 HTTPS

将域名的 DNS 记录指向服务器，并在服务器与云防火墙放行 TCP **80、443**。管理员登录后，进入 **设置 → HTTPS 与证书 → 打开证书设置**，填写域名并启用 HTTPS。自动证书由 Caddy 申请和续期。

也可以在首次部署时直接配置：

```bash
# 源码部署
sudo bash deploy/install.sh --domain hub.example.com --accept-acme-terms
```

Docker 部署则在首次运行前编辑 `.env`：

```dotenv
CONTEXT_HUB_DOMAIN=hub.example.com
CONTEXT_HUB_HTTPS_MODE=automatic
CONTEXT_HUB_ACCEPT_ACME_TERMS=true
```

启用自动证书前，请阅读 [Let's Encrypt 订户协议](https://letsencrypt.org/repository/)。域名只填写 `hub.example.com`，不带协议、端口或路径。HTTPS 配置完成后，通过 `https://你的域名` 访问，也可继续使用原 HTTP 端口。

HTTP 访问不会加密登录信息和内容，公网日常使用建议启用 HTTPS。已有反向代理时可选择“已有 HTTPS 入口”，配置要求见[运维说明](docs/operations.md)。

## 部署时可配置的选项

### 源码脚本参数

参数可组合使用，例如同时指定域名和网页端口：

```bash
sudo bash deploy/install.sh --port 8088 --domain hub.example.com --accept-acme-terms
```

| 参数 | 作用 |
| --- | --- |
| `--port 8088` | HTTP 网页端口，首次默认 `8080`；升级时不传则保留原值。 |
| `--domain hub.example.com` | 首次初始化 HTTPS 域名；已有域名在网页设置中修改。 |
| `--accept-acme-terms` | 同意自动证书协议，与首次配置的自动 HTTPS 域名一起使用。 |
| `--external-https` | 使用已有 HTTPS 反向代理，后续升级仍需传入。 |
| `--prefix /opt/contexthub-test` | 自定义安装前缀，默认 `/opt/contexthub`；升级沿用原值。 |
| `--service contexthub-test` | 自定义服务名，默认 `contexthub`；升级沿用原值。 |
| `--skip-dependencies` | 已安装所需依赖时，跳过系统依赖安装。 |
| `--no-start` | 首次安装时只初始化，不启动服务。 |
| `--help` | 查看参数帮助。 |

网页端口范围为 `1024–65535`，排除内部端口 `3000`、`3001`、`4080`、`4310`。修改端口后需同步调整防火墙。自定义前缀和服务名只能使用默认名称或在其后添加由小写字母、数字、短横线组成的后缀；当前部署方案支持同机运行一个实例。

### Docker 环境变量

Docker 脚本通过仓库根目录的 `.env` 接收配置，不使用上面的源码脚本参数。

| 变量 | 默认值与作用 |
| --- | --- |
| `CONTEXT_HUB_PORT` | `8080`，宿主机 HTTP 网页端口。 |
| `CONTEXT_HUB_DOMAIN` | 留空，首次启动时可填写 HTTPS 域名。 |
| `CONTEXT_HUB_HTTPS_MODE` | `automatic` 自动证书；`external` 已有 HTTPS 代理。 |
| `CONTEXT_HUB_ACCEPT_ACME_TERMS` | `false`；使用域名申请自动证书时设为 `true`。 |
| `CONTEXT_HUB_SETUP_PORT` | `4310`，仅绑定宿主机本地地址的维护端口。 |
| `CONTEXT_HUB_HTTP_BIND` | `0.0.0.0:80`，证书服务的 HTTP 绑定地址。 |
| `CONTEXT_HUB_HTTPS_BIND` | `0.0.0.0:443`，证书服务的 HTTPS 绑定地址。 |

域名和证书配置初始化后，在网页设置中管理。使用外部代理或调整端口绑定前，请参阅[运维说明](docs/operations.md)。

## 更新与备份

在服务器的源码仓库目录拉取新版本，再执行所用部署方式的脚本：

```bash
git pull --ff-only

# 源码部署
sudo bash deploy/install.sh
```

Docker 部署将最后一行换为 `sudo bash deploy/docker.sh`。自定义安装参数需沿用原值，Docker 需保持原 `.env`、项目名称及数据卷。

升级流程会备份现有状态、迁移数据库并检查服务，有短暂停机。账号、内容和配置保留。重装服务器前请另行保存完整备份；仅重新拉取 GitHub 源码不会恢复已有数据。

[查看升级、日志、密码恢复与完整备份指南](docs/operations.md)。

## 更多文档

- [摘要方案与记忆来源](docs/summary-engines.md)
- [MCP 工具与客户端压缩](docs/mcp-tools.md)
- [制作和导入桌宠](docs/pet-packs.md)
- [部署维护与备份恢复](docs/operations.md)
- [项目结构、模块边界与开发检查](docs/architecture.md)
