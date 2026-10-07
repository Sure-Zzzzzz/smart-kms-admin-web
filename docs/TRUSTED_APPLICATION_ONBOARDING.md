# KMS Web 可信应用接入手册

本文说明如何把 KMS 管理台登记到 IAM，配置统一应用门户 Portal 入口、浏览器授权客户端、权限清单、角色规则、人员准入和服务端令牌验证，并完成接入验收。示例统一入口为 `https://iam.example.com`，部署时替换为实际 HTTPS 地址。

本文的注册基线是 KMS Server / API Contract `2.0.2` 与 KMS Web `1.0.0`，API Contract 是服务接口文档版本，不是 npm 包。JSON 模板对应本基线，第 7 节说明本人公钥、销毁详情与生命周期接口，以及从 KMS `2.0.0`、`2.0.1` 升级时的边界。

实际注册顺序为：第 2 节创建应用，第 4 节提交权限清单，第 3 节配置菜单，第 5 节配置角色与人员准入，第 6 节配置令牌验证，最后执行第 8 节验收。

## 1. 角色分工

| 系统 | 负责内容 |
| --- | --- |
| IAM | 可信应用登记、浏览器授权客户端（OAuth Client，即在 IAM 中登记并发起授权的程序身份）、Portal 菜单、权限清单、角色规则和人员授权投影 |
| KMS Server | 验证身份、应用准入与精确 API 权限；本人接口固定归属，治理接口校验数据范围，旧公钥与密码学接口校验使用策略 |
| KMS Web | 使用独立 PKCE（以一次性校验值保护浏览器授权码流程）取得 IAM 人员令牌，经 Portal 挂载后访问 KMS API |
| 统一入口 Nginx | 在同一 HTTPS origin（协议、域名、端口）下转发 Portal、IAM 授权、KMS 静态资源和 API |

本应用的 PKCE 使用 S256，即通过 SHA-256 算法生成校验摘要的方法。人员令牌（Token）是证明当前身份与授权的访问凭证，KMS Web 只把它保存在当前浏览器会话，通过 `Authorization: Bearer`（在请求头携带令牌的认证方式）发送给 KMS；不使用门户 Bearer 或携带门户 Cookie 调用 KMS API。Secret 是客户端的机密认证凭据，浏览器公共客户端没有 Secret，IAM 资源验证客户端的 Secret 只交给 KMS Server。

## 2. IAM 侧注册

使用 IAM 管理台的“可信应用”创建流程，或调用同等管理 API。可复用 [创建请求模板](../deploy/iam/create-trusted-application.json)，先替换模板中的示例 origin。

| 字段 | KMS 基线值 | 规则 |
| --- | --- | --- |
| 应用编码 | `kms` | IAM 内唯一，与 KMS Server 的应用授权编码一致 |
| 应用名称 | `KMS 密钥管理` | 用于 Portal 和授权页面展示 |
| 图标 | `key` | IAM 受控内置图标编码 |
| Portal entry | `https://iam.example.com/app/kms/index.html` | 使用精确 HTTPS 静态入口 |
| Portal apiBase | `https://iam.example.com/api/kms` | 与静态入口、回调使用同一 origin |
| routePrefix | `/app/kms` | IAM 按 `applicationCode` 自动生成，不在创建请求中填写；与构建基路径一致 |
| 初始 Client id | `kms-portal-web` | `.env` 中的 `VITE_KMS_PKCE_CLIENT_ID` 填实际登记值 |
| 初始 Client 类型 | `PUBLIC` | 浏览器公共客户端，不生成 Secret |
| redirect URI | `https://iam.example.com/app/kms/oauth-callback` | 协议、域名、端口和路径须精确匹配 |
| grantTypes | `authorization_code` | 使用授权码流程及 S256 PKCE |
| authenticationMethods | `none` | 浏览器不持有客户端 Secret |
| scopes | `openid`、`profile` | OAuth 请求范围，不代替 API 权限或数据范围授权 |
| requireConsent | 模板为 `false` | 按组织的授权确认策略配置 |

调用 API 时先用 `GET /iam/admin/trusted-applications` 查找 `applicationCode=kms`，不存在时才使用模板调用 `POST /iam/admin/trusted-applications`。保存实际返回的 `applicationId` 和 PUBLIC Client id，避免重复注册。应用 id、用户 id 和角色 id 是运行态值，不写回仓库模板。

## 3. Portal 菜单与页面权限

配置或更新 Portal 菜单前，先按第 4 节确认完整权限清单已登记，再保存完整菜单树与默认入口。新建模板已同时提交清单与菜单，IAM 在创建事务中先登记清单后保存菜单。KMS 菜单应绑定以下页面权限：

| 菜单 code | 名称 | 子应用 route | 页面权限 |
| --- | --- | --- | --- |
| `my-keys` | 我的密钥 | `/my-keys` | `kms.page.my-keys` |
| `keys` | 密钥管理 | `/keys` | `kms.page.keys` |
| `policies` | 策略 | `/policies` | `kms.page.policies` |
| `destruction` | 销毁任务 | `/destruction` | `kms.page.destruction` |

创建模板使用 `menuTree`，四个节点均为 `PAGE`，按上表绑定 `requiredPagePermission`，Portal 据此按页面权限裁剪菜单。IAM 创建应用时先保存模板中的权限清单，再校验并保存菜单；更新已有应用时，先确认第 4 节的页面权限已经登记，再保存完整菜单树。对应数组如下：

```json
[
  { "code": "my-keys", "name": "我的密钥", "nodeType": "PAGE", "route": "/my-keys", "requiredPagePermission": "kms.page.my-keys", "sortOrder": 1, "children": [] },
  { "code": "keys", "name": "密钥管理", "nodeType": "PAGE", "route": "/keys", "requiredPagePermission": "kms.page.keys", "sortOrder": 2, "children": [] },
  { "code": "policies", "name": "策略", "nodeType": "PAGE", "route": "/policies", "requiredPagePermission": "kms.page.policies", "sortOrder": 3, "children": [] },
  { "code": "destruction", "name": "销毁任务", "nodeType": "PAGE", "route": "/destruction", "requiredPagePermission": "kms.page.destruction", "sortOrder": 4, "children": [] }
]
```

使用 API 时先读取 `GET /iam/admin/trusted-applications/{applicationId}` 的当前 `portal` 配置，再调用 `PUT /iam/admin/trusted-applications/{applicationId}/portal/configuration`。请求须包含 `enabled`、完整 `menuTree`、读取时的 `configVersion`，并保留正确的 `entry` 与 `apiBase`。创建请求不支持 `defaultEntry`，创建后在本配置接口设置 `{ "pageMenuCode": "my-keys", "entryPath": "/my-keys" }` 作为应用默认入口。更新已有配置时保留需要的默认入口；`defaultEntry` 响应中的 `path` 对应请求的 `entryPath`，`null` 会清空默认入口。`menus` 和 `menuTree` 不能同时提交，空树会清空菜单；配置版本冲突时重新读取后再编辑。默认入口必须引用保存树中有效的 PAGE。

Portal 将子应用 route 接到 `/app/kms` 下；浏览器通过 `https://iam.example.com/app/` 进入。KMS Web 以 `/api/kms/me` 返回的 `pagePermissions` 决定可见页面，不从角色名称推导权限。菜单可见不代表具备业务 API 权限，隐藏菜单也不能代替服务端拒绝。

## 4. 权限清单

使用同一 `applicationId` 调用 `PUT /iam/admin/trusted-applications/{applicationId}/permission-manifest`，提交完整权限清单。[权限清单模板](../deploy/iam/permission-manifest.json) 可用于首次注册或没有定制扩展的标准配置。更新已有应用前，先读取应用详情中的当前清单，保留仍在使用的角色、页面、API 和数据资源声明，再合并模板所需内容；不能用三个默认角色的模板直接覆盖包含额外角色或权限的存量配置。标准 `2.0.0 → 2.0.1` 和 `2.0.1 → 2.0.2` 均未新增权限码，原完整清单已经声明全部所需权限，不需要重放清单。

创建模板和权限清单已经声明 KMS 的全部 10 个 API 权限码：

| 能力 | API 权限码 |
| --- | --- |
| 当前主体权限快照 | `kms.me.read` |
| 密钥列表、详情与销毁进度 | `kms.key.read` |
| 创建、启停和轮换 | `kms.key.manage` |
| 密钥使用策略管理 | `kms.key.policy` |
| 销毁政策、安排和取消销毁 | `kms.key.destroy` |
| 签名 | `kms.sign` |
| 验签 | `kms.verify` |
| 加密 | `kms.encrypt` |
| 解密 | `kms.decrypt` |
| 公钥读取 | `kms.read-public-key` |

清单同时声明四个页面权限，以及 `kms-key` 数据资源的 `read`、`manage`、`policy`、`destroy` 动作和 `ownerPrincipalId` 维度。DATA 指 IAM 下发的数据范围授权，`ownerPrincipalId` 是密钥归属主体标识；服务端据此评估 DataPlan，即允许访问的数据范围。

声明权限码只说明应用支持该能力，不会自动把这些权限授予用户。`kms.key.destroy` 和 `kms.read-public-key` 已包含在完整清单中；实际权限由角色规则和用户投影决定，不能仅重复提交清单。本人公钥不需要额外使用策略，但缺少实际公钥 API 授权仍须拒绝。

## 5. 角色规则与人员准入

KMS 使用自己的业务角色，不借用 `iam_admin` 获得默认业务权限。管理员须为角色配置 KMS 的页面、API 和数据授权规则，实际访问依据用户投影，而非角色名称。

仓库提供 [管理员角色](../deploy/iam/roles/kms-admin.json)、[自助用户角色](../deploy/iam/roles/kms-self-service.json) 和 [密码服务角色](../deploy/iam/roles/kms-crypto-user.json) 创建模板，以及对应的 [管理员规则](../deploy/iam/role-rules/kms-admin.json)、[自助用户规则](../deploy/iam/role-rules/kms-self-service.json)、[密码服务规则](../deploy/iam/role-rules/kms-crypto-user.json)。当前模板行为如下：

| 角色 | 页面 | API 权限 | DATA 授权 |
| --- | --- | --- | --- |
| `kms-admin` | 四个 KMS 页面 | `kms.me.read`、`kms.key.read`、`kms.key.manage`、`kms.key.policy`、`kms.key.destroy`、`kms.read-public-key`，共 6 码 | `kms-key` 的四个动作，`all=true`，覆盖全部归属人 |
| `kms-self-service` | 我的密钥 | `kms.me.read`、`kms.key.read`、`kms.key.manage`、`kms.key.destroy`、`kms.read-public-key`，共 5 码 | `dataGrantTemplate=null` |
| `kms-crypto-user` | 无页面 | `kms.sign`、`kms.verify`、`kms.encrypt`、`kms.decrypt`、`kms.read-public-key`，共 5 码 | `dataGrantTemplate=null`，密码学调用另受精确密钥使用策略约束 |

`kms-admin` 的模板覆盖全部归属人的数据，仅适合确实需要该范围的管理主体；受限管理人员的规则应按实际授权范围配置。自助用户保持 `DATA=null`，本人接口由固定归属校验，不授予 `all=true`。默认自助角色的五项 API 已包含公钥读取；在应用准入、页面（PAGE）和对应 API 实际授权后，已验证人员可查看本人公钥，无需授予 `kms.key.policy`、策略页面或创建 `READ_PUBLIC_KEY` 使用策略。人员权限不因登记清单而自动获得，也不因本人归属而绕过 API 拒绝。

按以下顺序配置：

1. 查询 IAM 已有角色，按模板中的角色编码取得实际 `roleId`；不存在时才调用 `POST /iam/admin/roles` 创建对应角色。
2. 按 IAM 用户的对外 `subjectId` 查询 `GET /iam/admin/users/{subjectId}/application-authorizations/{applicationId}`。首次配置用户时，先用该路径的 `PUT` 建立 `admitted=true` 的应用准入，再配置角色投影；已有授权时，保留读取到的 `roles`、`pagePermissions`、`apiPermissions` 和 `dataGrantDocument`，只按目的修改准入。
3. 对每个角色调用 `PUT /iam/admin/roles/{roleId}/authorization-rules/{applicationId}`，提交该角色的完整 KMS 授权规则，触发已关联用户的投影重算。重复配置前读取实际规则，避免覆盖已配置的数据范围。
4. 给用户分配相应 KMS 角色，实际新增角色分配会触发投影重算。角色已经存在于用户时，重复分配不会重算；应在建立准入后保存对应角色规则并核验结果。
5. 重新读取用户应用授权和 KMS `/me`，核对准入、角色、页面、API 与 DATA 投影；页面与业务操作分别验收。

用户应用授权 `PUT` 是完整替换，不是只更新 `admitted`，也不会自动调用角色投影。以下空权限请求只适用于首次建立准入，必须接着执行角色配置与投影核验；不能在已有权限快照上原样重放：

```json
{
  "admitted": true,
  "roles": [],
  "pagePermissions": [],
  "apiPermissions": [],
  "dataGrantDocument": null
}
```

更新已有准入时，请求仍须包含 `admitted`、`roles`、`pagePermissions`、`apiPermissions`，并保留所需 `dataGrantDocument`；空数组会清空对应权限，`null` 会清除 DATA。角色规则并集是数据范围投影的权威来源，不能依赖用户授权中的手工 DATA 内容长期保留。

本人列表、详情、创建、销毁政策、公钥、销毁进度和生命周期操作绑定认证主体；第 7 节列出新增读取与本人写路径。本人公钥入口还要求身份经可信资源验证为 HUMAN（人员），包括 IAM 人员和继承人员权限的 AKU（AKSK 用户身份）；SERVICE（服务程序）身份不能使用该入口绕过策略。治理模式与共用写仍校验 API 权限和 DATA：启停与轮换要求 `manage`，安排与取消销毁要求 `destroy`。`/api/kms/admin/**` 管理查询同样受数据范围约束。

## 6. KMS Server 的人员令牌验证

在同一 KMS 可信应用下创建 Resource Verification Client，即供 KMS Server 向 IAM 验证人员令牌的保密客户端。可使用 IAM 管理台，或调用 `POST /iam/admin/trusted-applications/{applicationId}/resource-verification-clients`。

1. 创建独立资源验证客户端；API 请求只需 `clientId`，例如 `{ "clientId": "kms-resource-verifier" }`，不使用浏览器 OAuth Client 的创建请求。客户端凭据由 IAM 生成，明文 Secret 仅创建时返回一次。
2. 将 Secret 安全注入 KMS Server，例如本地部署使用 `IAM_RESOURCE_CLIENT_SECRET`。配置 IAM 的 `POST /iam/resource/tokens/verify` 地址和该验证客户端的 id；服务端验证请求使用验证客户端的 HTTP Basic 凭据，并提交待验证人员令牌，校验必须绑定同一 KMS 应用。返回的权限快照供 KMS 执行 API、PAGE 和 DATA 校验。
3. 验证 KMS 能使用该客户端校验人员令牌，并拒绝无准入、无 API 权限或无所需数据范围的调用。
4. Secret 轮换后同步更新 KMS Server；数据库清理后重新创建验证客户端并替换服务端配置。

这个客户端与 `kms-portal-web` 是两个不同客户端。验证客户端的 Secret 不得进入 `VITE_*` 配置、前端代码、浏览器、Nginx 配置、日志、shell 历史或 Git。IAM 人员令牌验证与 AKSK 服务令牌验证也不是同一配置；本手册描述 Web 人员接入。

## 7. 本人接口与版本升级

KMS `2.0.2` 新增以下只读接口，沿用现有权限码：

| 操作 | 方法与路径 | API 权限 | 归属与授权边界 |
| --- | --- | --- | --- |
| 本人公钥 | `GET /api/kms/me/keys/{keyRef}/public-keys` | `kms.read-public-key` | 已验证人员身份，固定本人归属，不要求 DATA 或使用策略 |
| 本人销毁详情 | `GET /api/kms/me/keys/{keyRef}/destruction` | `kms.key.read` | 固定本人归属，不要求 DATA |
| 治理销毁详情 | `GET /api/kms/admin/keys/{keyRef}/destruction` | `kms.key.read` | 要求覆盖目标归属人的 `kms-key:read` DATA |

本人公钥读取仍受应用准入、API 授权、本人归属及密钥和版本状态限制；Web 页面另需对应 PAGE 权限。仅 ES256 签名密钥的可分发公钥可读，活动或停用密钥的活动、退役版本可分发，待销毁或已销毁不分发。新建、历史及轮换版本遵循同一读取规则，无需补历史策略或迁移密钥数据。旧公钥入口与签名、验签、加密和解密仍要求精确密钥使用策略，SERVICE 身份继续使用旧入口；私钥和 AES 对称密钥材料不供 Web 查看或导出。

销毁详情显示各版本的计划时间、任务状态、完成时间和服务端计算的取消资格，不返回后台领取凭据。详情关闭重开或刷新后仍可回读，普通用户无需销毁任务页面权限。读取资格不等于执行授权：取消仍需 `kms.key.destroy`，服务端在执行时重新检查密钥状态及所有任务从未被领取过；曾被领取的任务即使回到待执行状态也不可取消。并发领取可能让页面显示的资格过期，以取消请求的最终校验为准。

KMS `2.0.1` 引入的本人生命周期写接口继续保留：

| 操作 | 方法与路径 | API 权限 | 归属边界 |
| --- | --- | --- | --- |
| 启用或停用 | `PATCH /api/kms/me/keys/{keyRef}/state` | `kms.key.manage` | 仅认证主体本人归属密钥，不要求 DATA |
| 轮换 | `POST /api/kms/me/keys/{keyRef}/versions` | `kms.key.manage` | 仅认证主体本人归属密钥，不要求 DATA |
| 安排销毁 | `PUT /api/kms/me/keys/{keyRef}/destruction` | `kms.key.destroy` | 仅认证主体本人归属密钥，不要求 DATA |
| 取消销毁 | `DELETE /api/kms/me/keys/{keyRef}/destruction` | `kms.key.destroy` | 仅认证主体本人归属密钥，不要求 DATA |

接口归属固定取自认证主体，不接收可由调用方任意指定的归属人；他人密钥必须拒绝。原有 `/api/kms/keys/{keyRef}/state`、`/api/kms/keys/{keyRef}/versions` 和 `/api/kms/keys/{keyRef}/destruction` 共用写接口继续要求对应 DATA。Web 按本人或治理模式选择接口，收到 403 或 404 不回退到旧公钥入口或另一种归属路径。

从标准 KMS `2.0.1` 配置升级到 `2.0.2` 时，先升级 Server，再部署本基线 Web `1.0.0`。原默认角色已经包含全部所需 API，应用无需重新注册，角色无需扩权，也无需补密钥使用策略或迁移数据库。仍须核验实际用户投影；定制角色缺少 `kms.read-public-key` 等所需 API 时，按预期授权修改对应规则并核验结果。保留现有准入、PAGE 和 DATA 范围，不重放完整模板覆盖定制配置。

KMS `2.0.0` 没有这四个本人写接口。其默认自助规则只有 `kms.me.read`、`kms.key.read`、`kms.key.manage`，且没有 DATA，不能单独完成共用写的生命周期。升级前保存当前与旧 Server 兼容的 Web 部署制品及其配置，明确可恢复的版本；本仓库 Web `1.0.0` 最低配套 Server 为 `2.0.2`，没有切换回旧接口的配置开关。从 `2.0.0` 升级时按以下顺序配置：

1. 先升级 KMS Server 到 `2.0.2`，保留原管理 API 的 DATA 校验。
2. 更新 IAM 配套角色规则：管理员增加 `kms.read-public-key`，自助用户增加 `kms.key.destroy` 和 `kms.read-public-key`，密码服务原五项 API 保持。自助规则继续为 `dataGrantTemplate=null`，管理员与受限治理主体的数据范围按原授权保留。
3. 核对角色变更后的用户投影。原 `2.0.0` 清单已申报全部 10 码，不需要新增权限码；应用准入和页面权限仍须配置。
4. 再部署本基线 Web `1.0.0`，本人操作使用 `/api/kms/me/keys/**`，治理写操作继续使用旧共用路径。Web 不能先于 KMS Server 升级，不能部署本基线 `Web 1.0.0 + Server 2.0.0/2.0.1` 的组合。
5. 对使用旧 `menus` 的已注册应用，按第 3 节更新为精确 PAGE 绑定的完整 `menuTree`，并配置本人默认入口；使用读取到的配置版本，保留正确的 entry、apiBase 和其他所需配置。

回滚到 Server `2.0.1` 或 `2.0.0` 时，先恢复升级前保存的兼容 Web 制品及配置，再回退 Server，并核验该组合的实际操作路径。若首次接入且没有兼容旧制品，不能只降低 Server 版本；须先撤下本基线 Web 1.0.0 的门户入口，避免暴露旧 Server 不支持的功能。前端不根据 403/404 自动回退接口；回退到 `2.0.1` 后旧公钥入口重新要求使用策略，不应以扩大角色权限替代该版本的调用契约。

## 8. 接入验收

使用受控验收用户与专用测试密钥，分别核验本人和治理路径。销毁任务仅用于明确允许销毁的测试密钥，密钥实际销毁不可恢复。

1. 从 HTTPS Portal 进入 KMS，核对可见菜单与 `/api/kms/me` 响应的 `pagePermissions` 一致；无页面权限时不能加载对应业务列表。
2. 核对浏览器 PUBLIC Client、S256 PKCE 和精确 redirect URI；KMS API 请求只发送本应用人员 Bearer，不携带门户 Cookie。不要将令牌值保存到验收截图或报告。
3. 在“我的密钥”读取本人列表和详情，确认密钥标识、状态、算法、活动版本及适用销毁政策。本人详情接口不返回 `ownerPrincipalId`，归属在服务端按认证主体固定，不要求抽屉展示归属字段；须核验本人列表和详情不会返回他人密钥。
4. 仅授予自助角色的本人页面、五项 API、`DATA=null`，不创建任何密钥使用策略，核对启停、轮换、安排与取消销毁使用 `/api/kms/me/keys/**`，无需治理页面或 DATA 即可操作本人密钥。验证缺 API 权限时被拒、他人密钥被拒、资源版本冲突不能覆盖新数据，以及旧共用写在无 DATA 时仍被拒。
5. 保存本人销毁窗口政策，核对它适用于本人名下全部密钥；选择窗口外时间必须拒绝，合规时间经确认后才能安排销毁。重新打开详情并刷新，核对各版本计划时间、状态、完成时间和取消资格。仅后台从未领取过的任务可取消，曾领取后重试仍不可取消；并发领取后取消须以服务端最终校验为准。保存政策不会自动安排销毁或改排已有任务。
6. 在上述零策略基线下读取本人 ES256 公钥，核对新建、历史与轮换后可分发版本一致可读，请求只走 `/api/kms/me/keys/{keyRef}/public-keys`，没有旧公钥请求或策略写入。分别验证缺公钥 API、他人归属、SERVICE 身份及待销毁/已销毁拒绝；可信人员身份包括 IAM 人员和继承人员权限的 AKU。私钥和对称密钥材料不得显示。旧公钥入口与密码学操作缺使用策略时仍须拒绝。
7. 管理员查询与共用写按已授权 DATA 范围验收，范围外密钥不可读写；治理销毁详情须同时检查 `kms.key.read` 和 `kms-key:read` DATA，不能用 destroy 权限代替读取授权。不要把管理员全量模板的通过结果当作自助角色的本人边界证据。
8. 撤销用户 KMS 应用准入或对应权限，重新验证 Portal 页面及受保护 API；分别核对应用可见性、页面权限和 API/数据授权拒绝，同一用户撤权后旧详情和迟到响应不能继续显示受保护内容。
9. 模拟写成功但详情回读失败，确认重试只重新读取，不重复生命周期写操作；写请求响应丢失时沿用原幂等请求（用于识别同一次操作的请求标识），不能生成新请求重复提交。回读或刷新不得清除正在确认的操作。

仓库浏览器测试使用受控后端夹具，不评估真实 IAM 用户投影或真实密钥销毁。接入完成的结论须来自实际部署版本、真实权限投影和对应业务接口的验收结果。

## 9. 常见错误

| 现象 | 优先检查 |
| --- | --- |
| Portal 看不到 KMS | Portal 集成是否开启、用户应用准入及页面权限是否已投影 |
| PKCE 回调失败 | PUBLIC Client id、S256、redirect URI 的协议/域名/端口/路径是否一致 |
| 清单已有销毁或公钥码但 API 仍拒绝 | 角色规则和用户投影是否实际授予该 API；申报清单不等于授予 |
| 2.0.0 自助启停、轮换或销毁被拒 | 共用写接口是否具有覆盖目标 `ownerPrincipalId` 的对应 DATA |
| 能读密钥却不能查看本人公钥 | 是否实际授予 `kms.read-public-key`、身份是否经验证为人员、是否本人归属、状态是否可分发；本基线无需补使用策略 |
| 旧公钥或密码学接口被拒 | 精确 API 权限、本人归属及密钥/版本/调用主体的使用策略是否满足 |
| 升级 2.0.2 后自助操作仍拒绝 | Server 与 Web 是否匹配、Web 是否调用本人路径、应用准入与实际用户投影是否满足，不能仅看清单已登记 |
| 销毁详情读取失败或无法取消 | 本人 read API、治理 read DATA 是否满足；是否发生任务领取或密钥版本冲突，取消以最终校验为准 |
| 数据库清理后 KMS 验证令牌失败 | 可信应用、清单、角色规则、用户准入和独立资源验证客户端是否均已恢复 |

## 10. 恢复与安全边界

数据库清理后按第 2 节注册、第 4 节权限清单、第 3 节菜单、第 5 节角色与用户授权、第 6 节资源验证客户端的顺序恢复，再按第 8 节验收。可以复用仓库码空间模板；运行态 id、验证客户端 Secret 和用户具体数据授权须以恢复后的实际值重新配置。

生产 Portal entry、PKCE 回调和资源验证地址统一使用 HTTPS。Secret、人员令牌、Cookie、真实用户标识和运行态授权内容不写日志、不进前端构建产物、不提交 Git。模板保留在 `deploy/iam/`；可信应用注册与授权操作统一由本手册维护，本地构建与 Nginx 接入见 [本地部署说明](../deploy/LOCAL_IAM_PORTAL.md)。
