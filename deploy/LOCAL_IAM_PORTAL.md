# KMS 本地 IAM Portal 联调

本地正式入口固定为 `https://iam.zs.com`（标准 HTTPS 443）。KMS 子应用通过独立 Nginx 容器承载，`iam-local-lb` 将 entry、静态资源和 KMS API 反代到该单元；不使用 Vite 作为 Portal 联调入口。注册物和回调地址只使用该正式入口。

## 构建与 Nginx

1. 本地 gitignored `.env` 设置 `VITE_KMS_PKCE_CLIENT_ID=kms-portal-web`。
2. 执行 `pnpm build` 生成 `dist/`。
3. KMS 走查宿主固定 `8390`（`application-walkthrough.yml`）；前端 `dist/` 由 `iam-local-lb` 直接挂载，`/api/kms/` 转发到 `host.docker.internal:8390`。
4. `iam-local-lb` 配置 `/app/kms/` 静态与 `/api/kms/` 到 `8390` 的转发规则并 reload。统一入口的 `/oauth2/` 保持归 IAM。

## IAM 注册与投影

`iam` 数据库清理后，先创建或恢复以下注册物，再进入 Portal 验收：

1. 先用 `GET /iam/admin/trusted-applications` 查找 `applicationCode=kms`；不存在时才 `POST /iam/admin/trusted-applications`，请求体使用 `iam/create-trusted-application.json`。其 PUBLIC client 没有 secret。
2. 记录返回的 `applicationId`，调用 `PUT /iam/admin/trusted-applications/{applicationId}/permission-manifest`，请求体使用 `iam/permission-manifest.json`。重复 PUT 是幂等的，可在数据库清理后重放。
3. 用 `POST /iam/admin/roles` 创建 `iam/roles/` 下三份角色模板，已存在时先查真实 `roleId`，不得重复创建。再分别调用 `PUT /iam/admin/roles/{roleId}/authorization-rules/{applicationId}`，请求体使用 `iam/role-rules/` 下对应文件。`kms-admin` 的 `kms-key` DATA grant 固定为 `all=true`，其他角色无静态 owner DATA grant。
4. 给验收用户分配对应 IAM 角色，并 PUT 用户应用准入。角色规则变更会重新计算用户的三权投影，无需让前端从 roles 推导权限。
5. 为同一 `applicationId` 调用 `POST /iam/admin/trusted-applications/{applicationId}/resource-verification-clients` 创建独立 CONFIDENTIAL 资源验证客户端；明文 secret 仅本次返回，必须立即放入 KMS 进程的 `IAM_RESOURCE_CLIENT_SECRET` 安全注入，不得进入本仓、浏览器、Nginx、日志或 shell 历史。数据库清理后需重新创建并替换服务端 secret。

建议把本节的 applicationId、roleId 和 userId 维护在本机密码管理器或临时环境变量中；仓库只保存可重放的码空间模板，不保存这些运行态值。

验证时从 `https://iam.zs.com/app/` 登录并选择 KMS。菜单和路由仅以 `/api/kms/me` 的 `pagePermissions` 为准；普通人员数据归属固定为已验证主体，管理范围仅由 `/api/kms/admin/**` 的 DataPlan 决定。若数据库被清理，重复本文件和 `deploy/iam/` 即可恢复码空间与投影定义。
