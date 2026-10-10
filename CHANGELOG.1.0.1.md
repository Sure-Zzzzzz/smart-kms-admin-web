# CHANGELOG - smart-kms-admin-web 1.0.1

## 变更

- 将 IAM 主题契约升级并锁定到 `1.0.5`，统一页头、说明区、数据表格、筛选、分页、空态、徽章和详情抽屉的管理台表现。
- 重排密钥、我的密钥、策略和销毁任务四页，补齐桌面与 390px 手机布局、短字段防换行、空态和表格滚动边界。
- 保持管理员治理与本人自助两条权限路径，继续使用 KMS Server `2.0.2` 的现有 API 契约，不改变后端接口、数据库或权限语义。
- 提供带 `built_in=0` 非内置标记的可选 IAM 兼容权限字典模板；明确 KMS 业务三权以应用授权投影为权威，兼容权限声明不代替业务授权。

## 验证

- Vitest：354/354 通过，覆盖率门槛通过。
- Playwright：全量 130 项首轮通过、7 项重试通过；挂载超时的 1 项经桌面和手机定向复验通过。共验证 138 项场景，覆盖主题、权限拒绝、生命周期、销毁、公钥、抽屉焦点和重试。
- `vue-tsc`、ESLint、`git diff --check` 和生产构建通过。

## 兼容性

- 最低配套 KMS Server / API Contract：`2.0.2`。
- IAM Server / Contract：`1.3.0`，兼容 `1.3.x` 向后兼容 patch。
- IAM Theme Contract：`@sure-zzzzzz/simple-iam-theme-contract` `1.0.5`。
- Frontend Contract：`1.0.1`。
