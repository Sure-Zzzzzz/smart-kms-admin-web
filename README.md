# smart-kms-admin-web

`1.0.1` 提供 KMS 管理端 qiankun 子应用，由 IAM 的统一应用门户（Portal）挂载，配套 KMS Server `2.0.2`。它通过 PKCE（以一次性校验值保护浏览器授权码流程）取得 IAM 人员令牌（访问凭证），调用 KMS API，并以 KMS `/me` 响应的页面权限控制路由和菜单。

## 页面

| 页面 | 路由 | 所需页面权限 | 主要能力 |
| --- | --- | --- | --- |
| 我的密钥 | `/app/kms/my-keys` | `kms.page.my-keys` | 本人列表、创建、详情抽屉、生命周期与销毁窗口政策 |
| 密钥管理 | `/app/kms/keys` | `kms.page.keys` | 授权数据范围内的列表（含归属主体、创建时间与按归属筛选）、详情与治理操作，创建经右上角弹窗；列表行可点击或回车选中（键盘可达），选中行打开详情 |
| 策略 | `/app/kms/policies` | `kms.page.policies` | 全量策略列表（密钥、双方主体、版本、操作、到期），按别名/被授权主体/操作筛选，行内撤销；创建经弹窗内查找并选定密钥 |
| 销毁任务 | `/app/kms/destruction` | `kms.page.destruction` | 任务与后台执行状态列表（含归属主体与按归属筛选）；安排与取消在密钥详情中进行 |

「我的密钥」提供当前主体归属密钥的列表，点击文字「查看详情」打开详情抽屉，展示密钥标识、用途、算法、状态、活动版本和创建/更新时间。本人详情接口不返回 `ownerPrincipalId`，归属由服务端固定为认证主体本人。详情中的操作不要求同时拥有「密钥」管理页权限，须具备对应 API 权限并通过服务端的本人归属校验；本人生命周期不要求 DATA 授权。

下表中的 DATA 是 IAM 下发的数据范围授权，`ownerPrincipalId` 是密钥归属主体标识。

| 操作 | 所需 API 权限 | 服务端归属与数据授权 |
| --- | --- | --- |
| 列表、详情与销毁进度 | `kms.key.read` | 归属固定为认证主体本人 |
| 创建 | `kms.key.manage` | 归属固定为认证主体本人，豁免 DATA 校验 |
| 启用、停用、轮换 | `kms.key.manage` | 本人接口固定认证主体归属，不要求 DATA |
| 读取或修改本人的销毁政策 | `kms.key.destroy` | 归属固定为认证主体本人 |
| 安排或取消销毁 | `kms.key.destroy` | 本人接口固定认证主体归属，不要求 DATA |
| 读取 ES256 公钥与选择可分发版本 | `kms.read-public-key` | 已验证的人员身份，归属固定为认证主体本人，无需额外密钥使用策略 |

「我的密钥」的生命周期写操作调用 `/me/keys/{keyRef}/state`、`/me/keys/{keyRef}/versions` 和 `/me/keys/{keyRef}/destruction`，归属严格固定为认证主体本人。默认 `kms-self-service` 规则授予本人页面和读取、管理、销毁、公钥相关的五项 API 权限，`dataGrantTemplate` 保持 `null`，无需用全量 DATA 授权完成本人操作。权限清单登记不等于角色授予：应用准入、页面（PAGE）和 API 权限仍须实际授权，本人归属由后端固定校验。「密钥」治理模式仍调用原 `/keys/{keyRef}/state`、`/keys/{keyRef}/versions` 和 `/keys/{keyRef}/destruction` 共用写接口，必须具有覆盖目标 `ownerPrincipalId` 的对应 `manage` 或 `destroy` DATA 授权。

在「我的密钥」顶部「销毁政策」或本人详情中的「修改销毁政策」编辑销毁窗口。政策按归属人生效，自动约束其名下全部密钥，无需逐把绑定，详情会显示当前适用政策；「策略」页管理的是密钥使用授权。保存销毁政策只修改以后安排销毁时允许的提前时间，不会自动安排销毁或重排已有任务；未设置的上下限分别不作限制。选择符合窗口的销毁时间并确认后，密钥进入待销毁状态。详情通过 `GET /api/kms/me/keys/{keyRef}/destruction` 回读各版本的计划时间、任务状态、完成时间和取消资格，关闭重开或刷新后仍可查询，无需销毁任务页面权限。取消仍须 `kms.key.destroy`，且服务端在执行时重新校验所有任务从未被后台领取过，成功后恢复安排前状态；曾被领取的任务即使重回待执行状态也不可取消。销毁完成不可恢复。

ES256 详情通过 `GET /api/kms/me/keys/{keyRef}/public-keys` 展示服务端允许分发的当前与历史公钥，支持选择版本和复制。该入口仅接受已验证为 HUMAN（人员）的身份，包括 IAM 人员和继承人员权限的 AKU（AKSK 用户身份）；仍须具备 `kms.read-public-key` 并满足本人归属，无需额外配置 `READ_PUBLIC_KEY` 密钥使用策略。旧密钥、新建密钥和轮换后的可分发版本遵循同一规则，不需要补历史授权数据。活动或停用密钥的活动、退役版本可分发；待销毁或已销毁密钥不提供公钥。公钥值为 X.509 DER（标准二进制公钥格式）的无填充 Base64url（适合 URL 使用的文本编码），不是私钥或 PEM 文本。私钥、AES 对称密钥材料不提供查看或导出；签名、验签、加密和解密由服务调用方通过 KMS API 执行。

本人公钥读取被拒绝时，核对应用准入、实际 API 授权、可信人员身份、本人归属和密钥状态，不通过创建使用策略解决。SERVICE（服务程序）身份继续调用旧公钥入口；旧公钥入口和密码学操作保留精确密钥使用策略校验。「策略」页的 `READ_PUBLIC_KEY` 仍用于授权旧入口调用方：版本留空授权该密钥全部版本（含后续轮换），到期时间留空表示长期有效，表单明确展示这两项授权范围。

「密钥」管理页查询 IAM 授予的数据范围，列表展示归属主体（宿主目录解析的显示名优先、来源徽章标注平台人员或服务凭证，缺失时回退原始标识，详情抽屉提供一键复制用于按归属筛选）与创建时间，支持按别名、状态和归属主体标识筛选；详情和生命周期操作同时接受 API 权限与数据范围校验。「策略」页为治理视角的全量策略列表，创建策略在弹窗内按别名查找并选定目标密钥后授予。「销毁任务」页同样支持按归属主体筛选。治理销毁详情通过 `GET /api/kms/admin/keys/{keyRef}/destruction` 查询，要求 `kms.key.read` 以及覆盖目标归属人的 `kms-key:read` DATA 授权。管理员可以读取授权范围内归属人的销毁政策，但修改政策只能由归属人本人在「我的密钥」进行；Web 公钥入口仅支持已验证人员身份的本人归属密钥。

## 接入基线

当前应用版本为 `1.0.1`。下表声明本版接入所依据的版本，不代表真实后端联调结果。

| 组件 | 接入版本与范围 |
| --- | --- |
| KMS Server | `smart-kms-server-starter` `2.0.2` |
| KMS API Contract | `2.0.2`，由 normal-sdks 的 `sdk/kms/server/contract/` 维护的接口文档版本，不是 npm 包 |
| IAM Server / Contract | `1.3.0`，兼容 `1.3.x` 向后兼容 patch |
| Unified Application Portal Web | `1.2.0` |
| IAM Theme Contract | `@sure-zzzzzz/simple-iam-theme-contract`，精确锁定 `1.0.5`；表格（DataTable）、对话框（Dialog）、页头、下拉、分页与空态/徽章/行内动作等通用样式族均由契约提供 |
| Frontend Contract | `1.0.1` Git 基线，[`c30429a`](https://github.com/Sure-Zzzzzz/simple-frontend-contract/commit/c30429a)，同级仓库 `link:` 构建 |

KMS 数据接口的权威定义见 [KMS API Contract](https://github.com/Sure-Zzzzzz/normal-sdks/tree/main/sdk/kms/server/contract)。门户管理登录态与主题；子应用消费主题快照，使用独立 PKCE 人员令牌访问 KMS，通过 `Authorization: Bearer`（在请求头携带令牌的认证方式）发送本应用令牌，不接收门户令牌或携带门户 Cookie。页面入口由 `/api/kms/me` 响应的 `pagePermissions` 决定；写操作须具备对应 API 权限，本人模式固定认证主体归属，治理模式另须覆盖目标归属人的 DATA 授权。

最低配套 Server 为 `2.0.2`。从标准 Server `2.0.1` 配置升级时，先升级 Server 再部署 Web，不需要扩大角色、重新注册应用或补历史密钥策略；定制规则缺少公钥 API 时仍须实际授予并核验用户投影。从 Server `2.0.0` 升级时，还须更新角色规则并核验投影，保留本人 `DATA=null`。本版 Web 不支持 Server `2.0.0` 或 `2.0.1`，收到 403/404 不会回退到旧本人公钥或治理接口。升级前保存兼容旧 Server 的 Web 制品与配置，回滚时先恢复该 Web 再回退 Server；没有兼容旧制品时先撤下门户入口。完整注册与升级步骤见 [可信应用接入手册](docs/TRUSTED_APPLICATION_ONBOARDING.md)。

## 本地 IAM Portal 联调

复制 `.env.example` 为 gitignored 的 `.env` 并填写 IAM 为 `kms` 可信应用创建的 PKCE 公共客户端 ID。正式联调使用独立 Nginx 单元和统一应用门户的 HTTPS `/app/` 入口，不使用 Vite 开发服务器作为 qiankun entry。

前置条件：Node.js 22.x（至少 `22.13.0`）或 24.x、pnpm `9.15.4`。通用前端契约通过 `link:`（引用本地源码包）构建，须先准备同级 `simple-frontend-contract` 仓库的 `1.0.1` 源码基线。其包入口位于 `dist/`，先构建契约，再安装和检查 KMS Web；以下命令在 KMS Web 根目录执行。`--frozen-lockfile` 使用已提交的依赖锁文件，依赖声明与锁文件不一致时终止安装。

```bash
npx pnpm@9.15.4 --dir ../simple-frontend-contract install --frozen-lockfile
npx pnpm@9.15.4 --dir ../simple-frontend-contract --filter @sure-zzzzzz/simple-frontend-contract run build
npx pnpm@9.15.4 install --frozen-lockfile
npx pnpm@9.15.4 run check
npx pnpm@9.15.4 run build
```

IAM 注册、Portal 菜单、权限清单、角色规则、人员准入与令牌验证统一见 [可信应用接入手册](docs/TRUSTED_APPLICATION_ONBOARDING.md)，配套 JSON 模板保留在 `deploy/iam/`。部署与统一入口反代模板位于 `deploy/`。必须经 Portal 的 `/app/kms/` 入口验收；直开子应用时只展示 Portal 引导页。

## 验证

```bash
npx pnpm@9.15.4 run type-check
npx pnpm@9.15.4 run lint
npx pnpm@9.15.4 run test:coverage
npx pnpm@9.15.4 run test:browser
npx pnpm@9.15.4 run check
```

`check` 包含类型检查、零警告 ESLint、覆盖率单测、生产构建和浏览器验收。浏览器测试使用本机 Chrome 无头模式，不下载浏览器；需预先安装 Chrome，并让本地 loopback `4188`、`4189` 端口保持空闲。

单测同时覆盖身份切换后的迟到响应、旧请求的 401（登录凭证失效）不清除新令牌，以及导航取消或子应用卸载后不回填身份、不触发旧授权跳转。

浏览器验收以 production 模式构建子应用，由受控 qiankun 宿主开启真实样式隔离后挂载，全部后端请求由夹具处理，不调用真实服务。本人基线为「我的密钥」页面、默认五项 API、`DATA=null` 和零密钥使用策略，公钥请求只走本人入口，不写策略。验收覆盖桌面与 390px 手机、详情与生命周期、销毁进度回读与取消资格、详情抽屉的键盘打开与关闭及来源焦点恢复、顶层 Tab/Shift+Tab 焦点约束、背景和下层抽屉滚动锁定及关闭/卸载恢复、嵌套确认和销毁政策弹窗的关闭边界、提交中关闭保护、销毁政策关联和安排/取消、公钥版本选择、页面/API 权限拒绝与重试、light/dark/custom 完整主题快照、FormSelect 键盘与关闭、Dialog 确认与取消、容器边界、可见焦点和布局溢出。验收构建、截图与失败 trace 均写入 gitignored 的 `test-results/`，不覆盖部署用 `dist/`；这组测试不能替代真实 IAM 与 KMS 的联调验收。

## 静态制品与部署

本应用为 `private` 的业务前端，部署制品是 `pnpm build` 生成的 `dist/` 静态目录，不通过 npm 发布。`package.json.version` 管理应用版本；本版使用 `v1.0.1` Git 标签记录已验收提交，并保留 `v1.0.0` 制品作为回滚基线；后续版本同时维护对应变更说明与兼容范围。

生产构建基路径为 `/app/kms/`。将 `dist/` 托管于独立 Nginx 单元，统一入口转发 `/app/kms/` 静态资源与 `/api/kms/` KMS API；IAM `/oauth2/` 与登录入口由统一入口管理。Portal 的可信应用 entry 指向 `<统一入口>/app/kms/index.html`，routePrefix 使用 `/app/kms`，PKCE 回调使用 `<统一入口>/app/kms/oauth-callback`。`deploy/nginx.conf` 是部署模板，后端上游须由部署环境配置。
