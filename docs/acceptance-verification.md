# 验收记录 · 2026-09-13

交付分支：codex/acceptance-ready。main 尚未包含本轮账号和部署功能，当前应明确检出该分支。

## 已完成

- 管理员入口：真实 Chrome 验证首页与手账页直接打开“管理员设置”；桌面与 390px 手机布局无横向溢出。普通用户不显示入口，服务端拒绝其管理请求。
- 清理历史功能：移除浏览器实验 WebMCP、未引用的样例数据，以及“仅本地演示”等过时提示。正式七个远程 MCP 工具保留。
- 前端拆分：首页和管理路由只组装模块，阅读头部、导航动画与滚动、账号管理操作分别独立。未使用 UI 模板保留，具体检查范围见 frontend-modules.md。
- 自动检查：TypeScript 全目录、产品 Oxlint、145 项 Node 业务测试、5 项 Python 备份测试、ShellCheck 通过。
- Docker：从 GitHub 实际克隆分支并构建；运行部署脚本，首次随机密码、强制改密激活、注册待审批、审批后登录、提升管理员、关闭注册均通过。
- 源码安装：从 GitHub 源码在全新 ubuntu:26.04 容器安装 Node 24.21.0、pnpm 11.19.0、Caddy 2.11.4、Python，完成生产构建、数据库迁移、600 权限初始密码文件。测试发现并修复 pnpm 全局安装路径问题。
- Docker 完整恢复：停止写入并备份到归档，恢复到另一 Compose 项目的新卷，重新部署。原密码、激活、角色、关闭注册与手账保持；新的 Chrome 会话读取原 Note 标题与正文。
- 源码完整恢复：在两个隔离 Ubuntu 测试容器间执行 backup.py 的备份、恢复、校验；已有测试实例状态保留在 before-restore 目录。
- 云端数据：真实双账号验证跨浏览器读取 Note、用户隔离及旧标签页写入保护；恢复后新浏览器的 localStorage、sessionStorage、IndexedDB 均为空。

## 实测边界

全新 Ubuntu 容器没有 systemd PID 1，因此源码依赖测试使用 --no-start，测试夹具仅替代 systemctl 的状态查询和 daemon-reload；不把它表述成系统重启验证。此前真实腾讯云主机已使用同一源码安装器验证 systemd 启动与持久化升级（deployment-verification.md）。本轮未重装实际服务器。

外部 Claude OAuth 与 Note 写入此前由用户实测成功；本轮复查其实现及自动测试，没有重新操作用户 Claude 授权，也未消耗真实模型额度。完整恢复保持账号和授权记录；令牌本身过期或更换域名时仍可能要求第三方重新授权。

服务端磁盘是数据保存位置，不是 GitHub。服务器重装前必须把完整备份复制到另一台机器；仅重新拉源码得到新实例。缓存、当前打开章节和滚动位置可丢弃；已经保存的用户内容与偏好通过账号存储。

## 复现入口

源码依赖夹具：deploy/tests/source-bootstrap.sh，只允许在可丢弃 Docker 容器执行。真实主机使用 deploy/install.sh。

业务测试：在 demo 中运行 pnpm typecheck、pnpm lint、pnpm test；根目录运行 python3 -m unittest discover -s deploy/tests -v 与 shellcheck deploy/install.sh deploy/docker.sh deploy/tests/source-bootstrap.sh。

浏览器流程：tests/account-lifecycle-browser.mjs 使用 LIFECYCLE_ORIGIN、LIFECYCLE_INITIAL_PASSWORD_FILE、LIFECYCLE_OUTPUT；生成的 state.json 仅保存合成测试凭据，不能提交 Git。在同一测试实例为 alice、bob 创建合成账号，再运行 tests/account-browser.mjs。备份恢复后改用新实例地址运行 lifecycle 用例 --after，以及 tests/account-restore-browser.mjs（LIFECYCLE_ORIGIN、LIFECYCLE_STATE_FILE）。测试必须使用独立实例。
