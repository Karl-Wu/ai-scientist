# Kady Agent Gateway

独立 Fastify 服务。当前实现提供进程探针和 PostgreSQL 连通性检查，可在开发环境单独启动。业务路由在后续任务中接入。

## 本地启动

需要 Node ≥ 22.19，开发环境默认使用嵌入式 [PGlite](https://pglite.dev/docs/)。在本目录运行：

```sh
npm ci
npm run dev
```

默认监听 127.0.0.1:8080。用 GATEWAY_HOST 和 GATEWAY_PORT 修改监听地址。从本目录启动时，PGlite 将数据保存在 `.pglite/`，可用 `GATEWAY_PGLITE_DIR` 指定目录。一个目录供一个开发进程使用。设置 `GATEWAY_DATABASE_URL` 即切换至外部 PostgreSQL，例如 `GATEWAY_DATABASE_URL=postgresql://localhost/kady_gateway npm start`。生产环境（`NODE_ENV=production`，镜像默认值）必须注入该连接串。切换后端不会搬迁数据。GET /livez 测进程，GET /readyz 执行 SELECT 1，连接或查询失败返回 503。当前就绪仅表示服务基础可用，业务上线还需完成登录、鉴权和代理验收。

检查命令为 npm run typecheck 和 npm test。容器构建上下文为本目录，使用 docker build -t kady-gateway . 构建。

## 托管接口契约

| 项目 | 首期约定 | 配置责任 |
|---|---|---|
| 公网域名与路径 | 试点以 https://agent.example.com 为示例。页面到共享 Next.js，/auth/* 与 /api/kady/* 到 Gateway；探针仅供集群访问。 | 平台运维配置 DNS、入口证书与路由 |
| 企业登录 | 同源回调 /auth/callback；用配置的企业 issuer 和该 issuer 下的 subject 映射内部用户。 | IdP 管理员登记回调与客户端；平台运维注入凭证 |
| 登录与实例映射 | Gateway 独占服务数据库账号。登录 Cookie 限定主站；托管 Web 构建时设置 NEXT_PUBLIC_ADK_API_URL=/api/kady。 | 平台运维提供 PostgreSQL、测试账号和备份；前端维护托管构建 |
| 内部身份 | Gateway 使用专属私钥签发短期令牌，issuer 约定 agent-gateway。每个托管 Agent 单独配置预期的 owner 与 agent ID 及受信公钥。 | 平台运维签发、分发及轮换密钥；私钥仅交给 Gateway |
| 内部 TLS | 私有 Agent Service 使用与其 DNS 匹配的证书；Gateway 信任平台分发的 CA。 | 集群运维负责内部证书、CA 与续期 |
| 归属示例 | A 和 B 各自访问 /api/kady/projects。登录会话分别定位到 agent-a、agent-b，对应的 Agent 校验自身实例与用户后处理 /projects。 | 运维登记绑定，Agent 部署独立注入归属 |

真实域名、IdP 客户端与集群证书在试点部署时填写。开发者本地双服务启动流程独立于 Gateway。
