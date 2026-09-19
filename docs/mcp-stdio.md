# stdio MCP 客户端

对于只能启动本机 stdio 进程的客户端，可以使用 HTTPS 转发适配器。它连接已部署的 ContextHub，不启动另一份服务或保存业务数据。

1. 在工作区“连接”页面创建令牌，复制该工作区的 HTTPS MCP 地址。
2. 在客户端电脑安装 Node.js 24，并获取 ContextHub 的生产构建产物。
3. 将客户端启动命令设为 `node /绝对路径/production/scripts/mcp-stdio.mjs`，通过客户端的环境变量配置传入：

```text
CONTEXT_HUB_MCP_URL=https://hub.example.com/mcp/工作区ID
CONTEXT_HUB_MCP_TOKEN=工作区连接页面生成的令牌
```

不要将令牌写进公开配置或提交到 Git。地址必须使用 HTTPS，不含用户名、查询参数或片段。适配器不跟随重定向；令牌到期或吊销后需在客户端更新授权。

适配器使用逐行 JSON-RPC，保留请求 ID 和协商后的协议版本，不输出通知响应，不自动重试写入。单行输入最多 1 MB，响应最多 8 MB，请求超时 30 秒。错误只显示状态，不回显远端正文或凭据。
