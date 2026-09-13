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

## 更新

源码版检出新版本后重新执行原安装命令。脚本先构建，随后短暂停止服务，保留 .wrangler 状态、迁移数据库并启动。已有数据时自动创建升级前备份。Docker 版重新运行 bash deploy/docker.sh。不要使用 docker compose down -v 升级，它会删除数据卷。

源码安装目录为 /opt/contexthub/app。--prefix、--service 可修改安装位置和服务名，--no-start 只安装不启动，--skip-dependencies 跳过已安装的依赖。参数见 deploy/install.sh --help。

## 忘记密码

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

恢复前校验清单与 SHA-256，拒绝不安全归档路径。目标已有数据时默认拒绝覆盖；--replace-existing 会先将原文件保留到 /var/backups/contexthub/before-restore-*。恢复后服务保持停止，部署命令负责启动。使用外部 HTTPS 时，源码备份与恢复均加 --skip-caddy。

默认 Compose 项目名为 contexthub，自定义项目要保持 --project 或 COMPOSE_PROJECT_NAME 一致。更换域名后需重新配置 HTTPS，第三方客户端可能要求重新授权。
