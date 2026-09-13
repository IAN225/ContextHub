# 部署与账号生命周期验收

日期：2026-09-13。服务器：Ubuntu 26.04、2 核 / 4 GB，腾讯云测试实例。

## 自动检查
- Windows：TypeScript、Oxlint 与 145 项测试通过。
- Linux Docker 镜像：145 项测试全部通过。
- Bash 语法、ShellCheck 与生成的 systemd 单元验证通过。
- Node / Vinext 生产构建在 Docker 和源码安装路径均通过。

## Docker 实机
- 使用独立 Compose 项目、仅绑定宿主机回环地址的测试端口和全新持久卷。
- 首次自动迁移数据库、生成随机管理员密码、强制登录改密激活。
- 真实 Chrome 验证：待审批用户无法登录；批准后可创建云端手账；晋升管理员、关闭注册正常，手机宽度页面可操作。
- 重建容器后，激活状态、密码、审批角色、注册开关及云端手账均保留。
- Docker 启动探测补齐 Caddy Origin；应用使用 Caddy 的网络空间，应用重启不改变 Caddy 的网络归属。
- 登录表单在账号状态加载完成前禁用输入，避免服务端渲染与客户端初始化之间丢失输入。

## 源码安装
- --prefix /opt/contexthub-install-test --service contexthub-install-test --skip-dependencies --no-start 完成安装、构建、迁移与随机管理员初始化。
- 初始密码文件权限为 600，归 contexthub 服务用户所有；--no-start 不启用开机自启。
- 迁移使用 Node 直接调用 Wrangler，避免 pnpm 在部署目录触发自动安装。

## 已有测试站点升级
- 使用相同源码安装脚本升级 https://contexthub.cloud，保留数据库、环境配置及 Caddy 状态。
- 升级前备份：/var/backups/contexthub/contexthub-20260913-095419.tar.gz。
- 只读哈希比对：账号及原密码派生值、云端记录、MCP 镜像与令牌 / OAuth 授权、模型设置和投递记录均与备份一致。
- 真实 HTTPS 验证：原 admin 密码可登录，必须改密激活，未激活时业务和管理 API 返回 403，注册关闭。
- contexthub / caddy-api 均 active，NRestarts=0。用户的激活动作留给管理员本人完成。

## 验收边界与保留资源
- 本轮没有调用付费模型，也没有替用户修改新的正式管理员密码。
- 临时 Compose 项目 contexthub-lifecycle 与 contexthub-lifecycle-final 已停止，测试卷保留；测试数据没有写入正式用户账号。
- 源码安装测试服务保持 disabled；正式服务独立运行。
- 功能范围与未实现项见 [功能审查](feature-audit.md)，操作说明见 [部署指南](deployment-and-activation.md)。
