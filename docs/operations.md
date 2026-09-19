# 运维

## 服务与日志

源码部署：

```bash
sudo systemctl status contexthub caddy-api
sudo journalctl -u contexthub -n 100 --no-pager
sudo systemctl restart contexthub
```

Docker 部署使用 docker compose ps 与 docker compose logs --tail 100。内部应用和数据库不需要额外开放公网端口。

管理员在网页“管理员设置”管理用户与证书。证书可选择 Caddy 自动申请续期，或已有 HTTPS 入口。源码部署使用已有反向代理时加 --external-https，代理转发到 127.0.0.1:4080，并保留 Host、设置 X-Forwarded-Proto: https。

无域名时访问 `http://服务器IP:8080`；网页不依赖 HTTPS，MCP 公开接口只接受 HTTPS。源码部署可用 `--port` 修改网页端口；Docker 修改 `.env` 中的 `CONTEXT_HUB_PORT` 后运行部署脚本。维护端口 4310 与内部应用端口不需要开放公网。

## 更新

开发与部署按同一条发布链路验证：先在开发电脑（包括 Windows）修改代码，在 `app/` 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`；提交并推送 GitHub 后，服务器从仓库拉取同一版本，再运行下方标准部署命令。交互验收访问实际部署域名，Windows 开发电脑不启动网站预览。不要绕过 GitHub 将本机修改直接覆盖到运行目录。

本地构建检查不能代替服务器部署检查；部署脚本仍负责备份、迁移、健康检查和失败恢复。源码安装脚本面向 Ubuntu/Debian，应用的开发、测试和构建不限定在 Ubuntu 上进行。

在检出的 GitHub 仓库根目录拉取新版本，然后执行对应的部署命令。源码目录应与 `/opt/contexthub/app` 运行目录分开。

```bash
git pull --ff-only
# 源码：域名和 HTTP 端口已持久保存，无需重复填写
# 自定义的 prefix、service 和 --external-https 仍需沿用
sudo bash deploy/install.sh
# Docker：保持原 .env、Compose 项目名称与持久卷
sudo bash deploy/docker.sh
```

有数据库时，命令自动进入升级流程：先构建，停止应用及本项目的证书服务，创建并校验完整状态快照，保存旧源码或 Docker 镜像及运行配置，然后迁移并启动新版。验证期间网页、MCP、投递接口暂停访问，后台任务暂停领取；健康检查通过后才恢复访问。失败时恢复旧代码和升级前的全部数据库、证书状态，避免旧代码读取新版数据。源码模式使用外部 HTTPS 时只管理应用本身。

账号、密码、原文、Note 及历史、摘要、附件、草稿、模型配置、后台任务和 MCP / OAuth 授权均保留；不用重新激活或重新导入。已经打开的旧页面如果版本不兼容，会提示复制未保存内容后刷新。同一账号可同时修改不同内容记录，修改同一记录仍会触发冲突保护。升级有短暂停机，不是滚动更新。

源码安装目录为 `/opt/contexthub/app`。`--prefix`、`--service` 可修改安装位置和服务名，`--skip-dependencies` 跳过已安装依赖；`--no-start` 仅用于首次安装，已有实例升级必须执行启动检查。Docker 脚本需要 sudo、Python 3.10+ 及同机标准本地卷。不使用 `docker compose down -v` 升级，也不直接把旧版本程序指向较新数据库。

恢复材料放在 `/var/backups/contexthub/upgrade-*`，包含私有凭据，目录权限为 700。源码快照包含已安装依赖，请预留至少旧程序与完整状态副本所需磁盘空间。确认新版稳定后可由管理员清理不再需要的历史快照和回退镜像；脚本不会自动删除它们。系统软件包、外部反向代理及其他云服务配置不在应用回退范围内。

若断电或进程被强制终止，脚本会拒绝覆盖尚未恢复的升级记录。按输出路径恢复：

```bash
sudo python3 deploy/upgrade.py source --recover /var/backups/contexthub/upgrade-实际编号
# Docker 改用 docker；自定义部署需带回原 --prefix、--service、--skip-caddy 或 --project
```

恢复命令只适用于未完成的升级。如果记录已经是 committed，但仍显示维护页，应先确认新版本健康，再移除该实例 `.wrangler/server/upgrade-maintenance` 文件；不要回退已接受新写入的实例。需要回退已成功发布的版本时，应按完整实例备份恢复流程操作。

### 移动端工作区验收

在部署域名检查 320、390、600、760 像素宽度：返回、全局设置（滑杆）和其他操作保持在顶部同一行；原文、摘要、Note、记忆包、连接、设置保持六列一行。480 像素及以下的“收录对话”显示为加号，长工作区名称省略显示。工作区设置仍从第六个标签打开，并显示选中状态；全局设置仍在保存完成后才允许跳转。首页 Context Hub 标题与右侧全局设置、任务、数据、搜索、账号图标也保持同一行。

在桌面宽度确认“设置”仍是章节标签，全局设置和收录按钮保留文字。以上为交互验收项目，类型检查与构建通过不代表已完成浏览器验收。

### 数据结构与后续版本

账号与业务表统一保存在 `.wrangler/server/accounts.sqlite`。SQLite 使用顺序迁移及迁移校验记录；启动前检查账号版本、旧 D1 已执行迁移、迁移文件校验和与数据库完整性。历史迁移不可修改或删除，新变更追加新迁移。高版本数据库由低版本新启动器读取时会被拒绝。

`account_records` 中每个账号的原文、附件、Note 正文、Note 历史、摘要、摘要设置、列表顺序和连接配置分别保存为独立记录；关系使用稳定 ID。各记录包含类型及格式版本。前端和个人 JSON 备份仍使用聚合视图，内部转换层负责拆分、重组和只提交变化的记录。以后改变存储形状时，必须追加对应格式转换和数据库迁移，不能只修改 TypeScript 类型。

MCP 镜像、后台任务状态和任务结果使用各自带版本的数据封套，传输类型按版本固定在 `app/lib/storage/payload-v1.ts`、`payload-v2.ts`，与页面的 Workspace 类型分开。升级可读取原先没有封套的记录，未知新版本会被拒绝处理。后续发布若改变字段语义，应新增版本和转换器，并验证旧的排队任务与未接收结果；不以清空数据库代替迁移。

模块可以分别开发，当前仍整体构建、发布一个应用。MCP / 任务数据库与账号数据库仍通过事件及接收回执协调，并非跨库单事务。普通模块功能更新可保留现有数据库运行；结构变化需要该版本明确提供迁移。

## 忘记密码

内置 `admin` 的当前密码可在服务器查看，网页修改和命令行重置后都会同步更新：

```bash
# 源码部署；自定义 prefix 时替换路径
sudo cat /opt/contexthub/app/.wrangler/server/admin-password.txt
# Docker：在 Compose 仓库根目录运行
sudo docker compose exec app cat .wrangler/server/admin-password.txt
```

该文件为明文，权限 600；请随完整实例备份妥善保存。账号数据库内的恢复副本采用加密存储，恢复密钥位于同目录的 `.admin-recovery-key`；升级备份需保留整个状态目录。普通用户及其他管理员只保存密码哈希。旧版本已经删除的密码无法从哈希还原，升级后首次成功登录或命令行重置 `admin` 时会生成恢复文件。

其他账号或缺少恢复文件时，可使用下面的命令行重置：

将新密码存到只有 contexthub 服务用户可读的临时文件，至少 12 个字符。使用服务器 CLI 重置，不把密码写入命令行参数：

```bash
cd /opt/contexthub/app
sudo -u contexthub /usr/local/bin/node scripts/accounts.mjs reset-password admin /var/lib/contexthub/new-password.txt
```

完成后删除临时文件。重置撤销该账号已有网页登录会话。

## 备份与恢复

数据保存在服务器，GitHub 只保存源码。重装磁盘前需要保留旧数据时，应将完整备份复制到另一台机器；不恢复备份的全新部署会生成新的空实例和管理员密码。

完整备份包含账号、内容、已保存附件、草稿、模型配置与密钥、后台任务、MCP / OAuth 授权、投递队列及证书状态。网页 JSON 导出仅是个人内容备份，不能替代完整实例备份。

工具要求 Linux、Python 3.10+；支持标准源码目录及同机 Docker 本地数据卷。归档包含私有凭据，权限为 600，但未加密，应妥善存放。

```bash
# 源码版：在检出的仓库根目录
sudo python3 deploy/backup.py backup /path/to/contexthub.tar.gz
sudo python3 deploy/backup.py verify /path/to/contexthub.tar.gz
# Docker 版另加 --mode docker
```

备份会短暂停止写入，完成后恢复原先运行的服务。恢复需保持部署方式：

```bash
# 源码版全新服务器：安装程序和用户，然后恢复并启动
sudo bash deploy/install.sh --no-start
sudo python3 deploy/backup.py restore /path/to/contexthub.tar.gz --replace-existing
sudo bash deploy/install.sh --domain hub.example.com --accept-acme-terms

# Docker 版全新服务器：准备原来的 .env，再恢复空数据卷
sudo python3 deploy/backup.py restore /path/to/contexthub.tar.gz --mode docker
sudo bash deploy/docker.sh
```

恢复前校验清单与 SHA-256，拒绝不安全归档路径。目标已有数据时默认拒绝覆盖；--replace-existing 会先将原文件保留到 /var/backups/contexthub/before-restore-\*。恢复后服务保持停止，部署命令负责启动。使用外部 HTTPS 时，源码备份与恢复均加 --skip-caddy。

默认 Compose 项目名为 contexthub，自定义项目要保持 --project 或 COMPOSE_PROJECT_NAME 一致。更换域名后需重新配置 HTTPS，第三方客户端可能要求重新授权。
