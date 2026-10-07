# smart-kms-admin-web 设计

## 定位

KMS 是 IAM Portal 的第二个业务 qiankun 子应用。AKSK Admin Web 已完成 Portal、qiankun、PKCE、主题契约和同源 Bearer 请求的首个闭环；本应用复用这些已验证机制，新增 KMS 的页面权限消费闭环。

本应用不提供本地登录、用户或角色管理，也不提供密码学操作控制台。浏览器只管理密钥元数据、精确策略和销毁状态；签名、验签、加密、解密仍是服务对服务 API。

## 路由与权限

| 路由 | 页面权限 | 数据来源 |
| --- | --- | --- |
| `/my-keys` | `kms.page.my-keys` | 当前主体的 KMS key API |
| `/keys` | `kms.page.keys` | KMS key API |
| `/policies` | `kms.page.policies` | KMS key policy API |
| `/destruction` | `kms.page.destruction` | destruction jobs + worker health API |

启动与每次重新授权后调用 `GET /api/kms/me`。路由守卫和菜单只依赖响应中的 `pagePermissions`，不根据 IAM roles 推导页面权限。401 发起 PKCE；已认证但没有页面权限时进入 `/403`。根路由按页面权限优先进入“我的密钥”，再进入管理页，避免 self-service 用户落到无权页面。

## 管理页交互基线

- 四个业务列表共享同一交互心智：右上角主按钮触发创建弹窗、行内「查看详情」打开抽屉、筛选与分页在列表内完成；治理类页面不常驻侧栏表单。
- 治理列表展示归属主体：显示名由宿主目录解析、来源徽章区分平台人员与服务凭证、缺失回退原始标识；详情抽屉提供归属标识一键复制用于按归属筛选。
- 「策略」页为治理视角全量策略列表：按密钥别名、被授权主体、操作筛选，行内撤销；创建在弹窗内按别名查找并选定目标密钥后授予，超量密钥靠查找定位而不分页。
- 「销毁任务」页展示归属主体并支持按归属筛选；空态区分筛选无果与真空。

## 安全与并发

- 请求固定 `credentials: 'omit'`，仅带子应用 PKCE 获得的 Bearer Token，避免与 Portal Cookie 形成多凭据。
- token、PKCE state 与 verifier 只保留在 `sessionStorage` 的 `kms.*` 键。
- 每个管理写动作在触发时生成一个 `Idempotency-Key`；同一次未知结果重试复用该键。
- `rowVersion` 来自最新资源响应；409 后重新读取，禁止前端静默覆盖。
- 销毁任务响应不展示 worker claim token；任何私钥、对称密钥和明文均不进入页面。

## 挂载与部署

构建基路径、Portal `routePrefix` 和 PKCE 回调统一是 `/app/kms/`。Portal 从 IAM 可信应用集成配置动态发现本应用，因此生产 Portal 无需新增硬编码注册；网关需把 `/app/kms/` 静态资源和 `/api/kms/` 转发至 KMS 部署单元，并同源代理 `/oauth2/` 到 IAM。
