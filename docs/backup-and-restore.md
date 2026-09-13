# 完整备份与重装恢复

账号让你在不同浏览器、设备间访问同一份云端数据；数据实际存放在你部署的服务器。GitHub 只提供程序代码。重装磁盘前，必须把完整备份下载到另一台机器，重装后再上传恢复。服务器上自己的备份也会随重装丢失。

工具适用于标准 Linux 源码部署和同机 Docker 本地卷，要求 Python 3.11+（源码安装脚本会安装 Python）。不处理远程 Docker daemon、网络卷和自定义外部数据库。恢复需保持部署方式与原域名；更换域名后应重新配置 HTTPS，第三方客户端可能需要重新授权。

备份包括账号及角色、激活和注册状态、手账、Note 与历史、附件正文、草稿、偏好、摘要、模型配置及密钥、后台任务、MCP / OAuth 授权、投递队列，以及 Caddy 证书和配置。没有下载的远端附件仍只是外部链接。自定义反向代理、系统服务额外环境变量由运维另行保存。

备份文件权限为 600，含账号和服务凭据，请作为私有数据保存，不能提交 GitHub。它不是加密压缩包。网页“云端数据”导出的 JSON 是个人内容备份，不包含全部账号、模型密钥或服务配置，不能替代此备份。

## 源码部署

在仓库根目录执行，脚本会短暂停止应用与 Caddy，完成后恢复原先运行的服务：

```bash
sudo python3 deploy/backup.py backup /var/backups/contexthub-full.tar.gz
sudo python3 deploy/backup.py verify /var/backups/contexthub-full.tar.gz
```

将备份下载到你的电脑，重装后再上传到新服务器。新服务器拉取相同或更新的兼容版本后：

```bash
# 先安装依赖、服务用户和程序，但不启动 Context Hub
sudo bash deploy/install.sh --no-start
# 备份先完整校验，再替换安装时生成的空实例；旧文件另存而非删除
sudo python3 deploy/backup.py restore /path/to/contexthub-full.tar.gz --replace-existing
# 使用原来的域名与证书选项启动
sudo bash deploy/install.sh --domain hub.example.com --accept-acme-terms
```

恢复后用备份中的原账号密码登录，不重新生成原账号，也不重复激活。自动证书配置从备份恢复。使用外部 HTTPS 的实例，备份和恢复都加 --skip-caddy，安装时使用 --external-https。

非默认安装前缀同时指定 --prefix /opt/contexthub-test --service contexthub-test。不要对运行中的其他实例使用同一前缀。

## Docker 部署

标准项目名固定为 contexthub；自定义项目始终保持 COMPOSE_PROJECT_NAME 或 --project 一致。工具要求 sudo 能访问同一个 Docker daemon。

```bash
sudo python3 deploy/backup.py backup /var/backups/contexthub-docker.tar.gz --mode docker
sudo python3 deploy/backup.py verify /var/backups/contexthub-docker.tar.gz
```

在全新服务器安装 Docker / Compose 和 Python 3.11+，检出源码，并上传完整备份：

```bash
cp .env.example .env
# 填写原域名和证书选项，先不要启动空实例
sudo python3 deploy/backup.py restore /path/to/contexthub-docker.tar.gz --mode docker
sudo bash deploy/docker.sh
```

恢复工具会创建尚不存在的数据卷，再写入已校验的内容。若目标已有数据默认拒绝恢复；明确需要替换时加 --replace-existing，旧内容会留在 /var/backups/contexthub/before-restore-* 下。恢复后服务保持停止，下一条部署命令负责迁移与启动。

不要使用 docker compose down -v 更新或恢复，它会删除数据卷。更换源码检出目录不会换掉默认卷。旧版本使用目录名作为项目名的部署，应继续指定原来的项目名，以免打开新的空实例。

## 校验与失败处理

归档带文件清单和逐文件 SHA-256。恢复先校验文件内容，拒绝路径穿越、符号链接、硬链接、设备文件和重复条目；目标服务在数据替换前停止。校验失败不会改动目标数据。复制阶段失败会保持服务停止，原文件仍在 before-restore 目录，不要立即启动部分恢复的数据。

恢复使用相同部署方式；此脚本不自动转换源码版与 Docker 版的证书目录布局。仅有备份文件而未做恢复演练，不能视为已验证重装恢复。
