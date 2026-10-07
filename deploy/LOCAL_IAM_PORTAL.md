# KMS 本地构建与 Nginx 接入

本文仅维护本地静态制品构建和 Nginx 接入。可信应用注册、Portal 菜单、权限清单、角色规则、人员准入和资源验证客户端统一按 [可信应用接入手册](../docs/TRUSTED_APPLICATION_ONBOARDING.md) 配置；注册模板仍位于 `deploy/iam/`，本文不重复维护注册流程。

统一入口示例为 `https://iam.example.com`（标准 HTTPS 443），部署时替换为实际地址。KMS 静态资源和 API 使用同一 HTTPS 入口；Portal 联调不使用 Vite 开发服务器作为子应用 entry。

## 构建与 Nginx

1. 使用 Node.js 22.x（至少 `22.13.0`）或 24.x 和 pnpm `9.15.4`。同级 `simple-frontend-contract` 仓库使用 `1.0.0` 基线提交 `f63d03e79f575063df5fa8a436fca3945b686c49`，先按根 README 冻结安装并构建契约，再冻结安装 KMS Web；主题契约由锁文件精确使用 `1.0.3`。
2. 本地 gitignored `.env` 设置 `VITE_KMS_PKCE_CLIENT_ID` 为 IAM 已登记的 PUBLIC OAuth Client（浏览器公共授权客户端）的 client id（客户端标识）；模板示例为 `kms-portal-web`，不填写 Secret（客户端机密认证凭据）。
3. 执行 `pnpm build` 生成 `dist/`。前端构建基路径为 `/app/kms/`。
4. 参考 [Nginx 模板](nginx.conf)，将 `dist/` 挂载到静态目录 `/www/kms-admin/`，承载 `/app/kms/`。统一入口可直接托管该目录，或反代到独立 Nginx 单元。
5. 配置 `/api/kms/` 到 KMS Server 的反代；模板示例为 `host.docker.internal:8390`，端口和上游地址按实际部署环境替换。统一入口的 `/oauth2/` 保持归 IAM。
6. 校验 Nginx 配置后 reload，从 `https://iam.example.com/app/` 登录并进入 `/app/kms/`；entry 与 PKCE 回调路径须与正式手册中的登记值一致。

## 本地核验

构建后的 `index.html` 不长期缓存，带内容摘要的资源可使用不可变缓存；模板已配置相应 `Cache-Control`。静态路由回退到 `/app/kms/index.html`，API 请求转发到 KMS Server。PUBLIC Client id 变更后须重新构建前端。

核对 `/app/kms/index.html`、构建资源和 `/api/kms/me` 能经统一入口访问；直开子应用只应显示 Portal 引导页。完整权限及业务验收按正式 [可信应用接入手册](../docs/TRUSTED_APPLICATION_ONBOARDING.md#8-接入验收) 执行。

角色或资源验证客户端配置失败不会由重新构建静态制品修复；数据库清理后的注册恢复按正式手册执行。
