# DG-Agent

这是 `DG-Agent` 的实验重写仓库。

## 当前定位

- 主产品仍然是 `apps/web`
- 默认运行路径仍然是 **浏览器内嵌 runtime**
- Web Bluetooth 仍然是本地设备控制的主路径
- CLI / daemon / public API 目前只保留架构边界，不是当前交付物

## 核心架构

### 核心链路

`Web UI -> AgentClient(embedded) -> Runtime -> DevicePort / LlmPort / PermissionPort`

当前默认链路也可以表述为：

`apps/web -> AgentClient(embedded) -> runtime -> browser/device/provider adapters`

### 当前实现形态

如果用“层 + 职责”来描述当前仓库：

- `apps/web`：组合层
- `packages/client`：调用抽象层
- `packages/runtime`：行为与安全核心
- `packages/device-*`：设备适配层
- `packages/providers-*`：模型适配层
- `packages/storage-browser`：浏览器状态持久化
- `packages/bridge-*`：桥接平台接入与桥接核心

这个形态比“单前端工程里塞所有逻辑”更接近目标状态。

### 主要分层

- `apps/web`
  - 只负责组合依赖、展示状态、采集输入
  - 通过 hooks 组织会话、语音、波形等前端流程
- `packages/client`
  - 提供 `AgentClient` 抽象
  - 隔离页面与 runtime / future transport
- `packages/runtime`
  - 负责会话编排、tool loop、策略执行、设备命令调度、运行时事件、session trace
  - 当前已拆为 `agent-runtime`、`runtime-tool-executor`、`runtime-turn-state`、`runtime-errors`、`session-trace`
- `packages/storage-browser`
  - 负责浏览器设置、会话存储与独立 trace 存储
  - 当前已拆为 settings store、session store、session trace store
- `packages/bridge-core`
  - 负责桥接平台抽象、消息队列、远程权限、桥接管理器
  - 当前已拆为 types / queue / permission / manager / utils
- `packages/device-*` / `packages/providers-*`
  - 分别承载平台设备适配与模型提供方适配

### 当前未交付，但保留边界

#### CLI

未来可以加 CLI，但当前仓库没有 `apps/cli` 交付物。

要求：

- 不允许为了 future CLI 反向污染当前 Web 主路径
- 只保留 runtime / client / contracts 边界即可

#### daemon / public API

当前仓库没有 daemon app 交付物。

保留边界的原则：

- 可以有 future daemon / public API
- 但不能把它们设计成“网页主流程的前提条件”
- 对外 API 更适合承载账号、同步、日志、云端能力，而不是直接控制用户本机蓝牙设备

#### Node 侧 BLE

当前不实现真机 Node BLE，只保留 `DevicePort` 边界。

原因：

- 真实路线还没收敛
- 当前优先级仍然是浏览器主路径与 runtime 护栏

## 当前消息模型与运行记录分层

当前实现已经收敛为三层：

- `session.messages`
  - 只持久化正常对话正文，主要是 `user / assistant`
- `session trace`
  - 持久化工具调用、执行结果、拒绝、失败、定时器等结构化记录
- `ephemeral trigger`
  - 定时器到期、工具拒绝 / 失败后的内部跟进提示，只用于触发下一轮模型收口，不写入会话正文

补充约束：

- 前端会把 trace 投影成展示用系统气泡，但这些记录不直接作为原始 chat history 持久化
- `session trace` 已从 `session.metadata` 拆出，单独存入 trace store
- 前端按需加载 trace，比把所有运行记录塞回会话快照更稳定

这样做的原因：

- 内部系统触发文本不应继续污染 chat history
- tool / timer 记录需要留档，但它们更适合结构化 trace，而不是伪装成聊天消息
- timer / system work 和主 turn 并行时，整对象覆盖保存会带来 trace 丢失风险
- 这样才能同时满足“模型需要上下文”和“用户看到的聊天记录干净”两件事

## 当前模型上下文策略

当前模型上下文不是固定全量历史，而是可配置策略。

浏览器设置里目前提供 3 种策略：

- `截取到上一轮用户 prompt`
- `截取前五轮用户 prompt`
- `无限制`

默认值是 `截取到上一轮用户 prompt`。

当前实现约束：

- 这是一项浏览器设置，保存在 `storage-browser`
- 运行时构造模型上下文时按该策略裁剪 `session.messages`
- tool / timer / deny / fail 等运行记录仍然只进 `trace`，不会因为上下文策略切换而回流进聊天正文

## 已确认的架构决策

### 1. `runtime-first`

先把 `core / contracts / runtime` 站稳，再让 `web` 去组合这些能力。

原因：

- 避免再次出现“页面就是业务核心”
- 安全限制、tool loop、设备命令调度应当属于 runtime，而不是 UI
- 后续如果接 CLI / daemon / API，复用的核心也应该是 runtime

### 2. 浏览器优先（Browser-first）

当前主产品仍然是浏览器页面，不是 daemon，不是 Electron，也不是本地服务。

原因：

- 这仍然最符合真实用户使用方式
- Web Bluetooth 这种本地设备能力，本来就发生在浏览器
- 不能把主流程建立在“用户先安装本地 helper”这个前提上

### 3. `AgentClient` 作为页面唯一入口

页面层不直接依赖 `AgentRuntime`。

原因：

- `web` 只面向抽象 client，避免被 runtime 内部实现绑死
- future transport 可以替换，但页面调用面不变
- 页面层更容易保持“组合层”身份

### 4. 运行时继续按职责拆分

当前 `packages/runtime` 已明确拆分为：

- `agent-runtime`
- `runtime-tool-executor`
- `runtime-turn-state`
- `runtime-errors`
- `session-trace`

原因：

- `AgentRuntime` 应该保留主流程，不继续膨胀成“第二个巨石文件”
- tool 执行、turn 状态、错误归一化属于清晰的内部职责
- tool / timer / deny 等结构化记录不应该继续和会话正文硬耦合

### 5. 浏览器存储与桥接核心都要避免“单文件核心化”

当前已经明确拆分：

- `packages/storage-browser`
  - settings store
  - session store
  - session trace store
- `packages/bridge-core`
  - bridge types
  - message queue
  - permission port
  - bridge manager
  - bridge utils

原因：

- 这些模块本质上已经是独立逻辑域
- 继续堆在一个 `index.ts` 里，只会把可维护性问题推迟

### 6. 页面流程用 hooks 组织，而不是把行为继续堆在 `App.tsx`

当前前端组合层已经分出：

- `use-browser-app-services`
- `use-runtime-session-state`
- `use-waveform-manager`
- `use-voice-controller`

原因：

- 会话同步、语音流、波形库流都不是“渲染细节”
- 它们应当是无 UI 的前端行为模块

## 架构护栏

这部分不是介绍项目“有什么”，而是约束项目“不要重新长回去”。

### 1. 依赖方向

主依赖方向：

`apps/web -> packages/client -> packages/runtime -> packages/contracts -> packages/core`

允许的侧向依赖：

- `apps/web -> packages/storage-browser`
- `apps/web -> packages/theme-browser`
- `apps/web -> packages/update-browser`
- `apps/web -> packages/audio-browser`
- `apps/web -> packages/bridge-browser`
- `apps/web -> packages/bridge-core`
- `apps/web -> packages/device-webbluetooth`
- `apps/web -> packages/providers-*`
- `apps/web -> packages/waveforms-browser`

禁止：

- `runtime -> web`
- `runtime -> react`
- `runtime -> vite`
- `core -> browser API`
- `core -> node API`
- `web -> 直接操作设备协议`

### 2. 页面层职责

`apps/web` 只负责：

- 组合依赖
- 维护页面状态
- 订阅 runtime 事件
- 展示状态与采集输入
- 调用 `AgentClient`
- 维护“会话快照”和“实时设备状态”的前端镜像

`apps/web` 不负责：

- tool schema 定义
- 策略判定
- 命令串行
- 设备协议
- provider HTTP 请求拼装

### 3. 页面行为组织方式

页面里的非渲染逻辑，优先收敛为 hooks，而不是堆进 `App.tsx`。

当前典型职责：

- `use-browser-app-services`：浏览器依赖组装
- `use-runtime-session-state`：会话同步与 runtime 事件镜像
- `use-waveform-manager`：波形导入 / 编辑 / 删除
- `use-voice-controller`：语音输入、语音回放、voice mode

新增页面流程时，优先问自己：

1. 这是渲染逻辑，还是行为逻辑？
2. 如果它不关心 JSX，它是不是应该成为 hook？

### 4. Runtime 职责

`packages/runtime` 负责：

- 会话编排
- tool loop
- tool 执行
- 策略评估
- 权限请求入口
- 设备命令队列
- 运行时事件
- system work queue（例如 timer 到期后的串行处理）
- session trace 记录

`packages/runtime` 不负责：

- React 状态
- 浏览器窗口生命周期
- 具体 provider 表单逻辑
- 具体设备 UI

### 5. Storage 职责

`packages/storage-browser` 负责：

- 浏览器设置默认值
- 设置 schema 校验
- API key / voice key 持久化策略
- 浏览器会话存储
- 浏览器 session trace 存储

`packages/storage-browser` 不负责：

- 页面展示逻辑
- provider 网络调用
- 运行时安全策略

### 6. 消息与 trace 护栏

默认规则：

- `session.messages` 只保留正常聊天正文
- tool result / deny / fail / timer 等运行记录写入 trace
- timer 到期、deny / fail 后用于收口的内部提示使用 ephemeral input，不写入会话正文

禁止重新引入：

- 把内部系统提示长期持久化到 `session.messages`
- 把工具输出伪装成原始聊天消息塞回 history
- 把 trace 再塞回 `session.metadata` 做整对象覆盖保存
- 允许在 `session.metadata` 里保留轻量索引信息（例如桥接来源），但不要把运行记录重新堆回去

### 7. Bridge 职责

`packages/bridge-core` 负责：

- 桥接平台抽象
- 消息队列
- 远程权限确认
- 桥接消息路由
- 桥接状态 / 日志广播

`packages/bridge-browser` 负责：

- QQ / Telegram 等浏览器侧适配器实现

桥接相关不应直接侵入页面组件。

当前桥接行为补充：

- 桥接消息默认优先路由到**当前激活会话**
- 如果当前没有激活会话，且页面处于初始空白态，前端会先创建一个新会话，再把桥接消息打进去
- 不再默认把桥接消息固定路由到某个旧的 `bridge:*` 历史会话
- 桥接来源（平台 / 目标用户或群）会持久化到 `session.metadata` 的轻量字段中，用于在桥接管理器重建后恢复回发目标
- 因此即使在设置里修改桥接配置并保存，旧会话里的后续回复仍应继续回到原来的 QQ / Telegram 对象
- 桥接适配器注册表按“适配器实例”解绑，避免旧桥接管理器在停止时误删新桥接管理器刚注册的 QQ / Telegram 适配器
- QQ/NapCat 的 Token 通过 WebSocket URL 查询参数 `access_token` 传递，不通过 Header
- 设置里的 `accessToken` 字段本质上是帮助补全 `wsUrl`；如果 `wsUrl` 已经自带 `access_token`，则以 `wsUrl` 为准
- QQ 出站发送会等待 NapCat / OneBot action response 回执，只有拿到成功回执才视为发送成功
- 桥接面板日志应能看到启动中、连接中、已连接、接收消息、准备发送、发送成功、发送失败等状态

### 8. Provider / Device 适配层职责

`providers-*` 只做：

- provider 输入输出映射
- provider 默认值与兼容参数处理

`device-*` 只做：

- 平台能力接入
- 协议连接 / 断开 / 命令执行
- 设备状态映射

这两层都不做：

- 页面状态管理
- 会话编排
- UI 权限流

### 9. 新功能接入规则

新增功能前先判断：

1. 它是领域逻辑、运行时逻辑，还是平台接入？
2. 它应该长在 runtime，还是应该是新的 adapter / store / hook？
3. 它会不会让 `apps/web` 知道过多底层细节？

如果答案是“会让页面知道太多”，那通常就是放错层了。

### 10. 默认优先级

实现顺序始终优先：

1. 边界
2. 模型
3. 机制
4. UI

不要反过来。

## 目录

```text
apps/
  web/                     当前主产品

packages/
  api-contracts/           API DTO 与路由契约
  audio-browser/           浏览器语音输入 / TTS 适配
  bridge-browser/          浏览器侧桥接适配器
  bridge-core/             桥接核心逻辑
  client/                  AgentClient 抽象
  contracts/               端口定义
  core/                    领域模型与共享类型
  device-webbluetooth/     浏览器蓝牙设备适配
  permissions-basic/       基础权限策略适配
  permissions-browser/     浏览器权限适配
  prompts-basic/           基础提示词预设
  providers-catalog/       Provider 元数据与归一化
  providers-openai-http/   OpenAI / 兼容 HTTP Provider 适配
  runtime/                 核心运行时
  safety-browser/          浏览器安全守卫
  storage-browser/         浏览器设置 / 会话存储
  testkit/                 Fake adapters / fixtures
  theme-browser/           主题适配
  update-browser/          浏览器更新检查
  waveforms-basic/         内置波形库
  waveforms-browser/       浏览器波形导入 / 存储

docs/
  architecture-decisions.md
  architecture-guardrails.md
  ui-maintenance-notes.md
```

## 开发命令

- 安装依赖：`npm install`
- 启动 Web：`npm run dev`
- 类型检查：`npm run typecheck`
- 逻辑验证：`npm run test`

## 当前验证方式

当前逻辑层验证以 **workspace typecheck + package self-test** 为主：

- `packages/runtime`
- `packages/bridge-core`
- `packages/storage-browser`
- `packages/providers-catalog`

## UI 维护重点与接手注意事项

这部分用于给后续接手 `DG-Agent-rewrite` 前端的人快速建立共识。重点不是解释架构，而是减少反复误改、避免把用户已经确认过的行为改坏。

### 工作方式

- 先看真实页面，再改代码
- 涉及滚动、吸顶、浮层、响应式时，优先用 Playwright 验证真实页面，不要凭记忆改

### 不要随手改的地方

#### 左侧边栏 spacing

下面这些位置的 padding / margin / 对齐，用户已经来回调过很多次：

- 展开 / 收起按钮
- 发起新对话
- 对话标题
- 会话条目
- 设置与控制

**不要再顺手优化。**

#### 发送区布局

- 发送按钮必须保留在输入框下面这一行
- 不要改回“输入框右侧并列发送按钮”
- 输入区现在是**底部悬浮**，不是普通占位块

### ChatPanel 当前 UX 约束

#### 顶部标题栏

- 标题栏应始终对用户可见
- 滚动聊天记录时不要把标题栏滚没
- 连接后的设备状态条现在在**标题栏下方**，不是塞在主标题栏中间
- 桌面端状态条宽度参考标题栏可用宽度，不再按消息区 `max-width` 居中
- 未连接时，状态条和相关分界线应完全收起，不要留下半截线
- 状态条只显示 A / B 通道，不显示电量
- 未连接时，标题栏左侧不显示“设备未连接”

#### 输入区

- 输入区是**悬浮层**
- 不能因为消息过短而往上跑
- 消息列表底部必须保留足够安全垫，避免最后内容被输入区遮住

#### 空态

- 空会话时只显示 `欢迎使用 DG-Agent ！`
- 不再显示示例提示词和大段说明

### 提示信息约束

#### 顶部 toast

- 顶部 toast 只负责全局提示和需要浮层提示的反馈
- 如果某条错误已经显示在聊天区助手泡泡里，就**不要重复在 toast 再显示**
- toast 文案应尽量中文化

#### 聊天气泡中的系统反馈

- 定时器相关系统消息不要放在顶部 toast
- 应显示为聊天区中间的系统气泡

#### 输入框上方的小气泡

- 已删除
- 不要恢复成输入框上方一排黄 / 绿 / 红小气泡

### 设备与模型行为约束

#### 蓝牙连接

- **只有用户主动点击“连接设备”时，才允许弹出蓝牙选择器**
- 发消息不能自动触发蓝牙连接
- AI 请求设备工具时也不要偷偷帮用户连蓝牙

#### 设备未连接时的工具调用

- 如果 AI 请求的是设备类工具，而当前设备未连接：
  - 直接返回“设备未连接，请先点击连接设备”
  - 不要继续让模型跑下一轮
  - 不要先冒出波形找不到之类的次级错误

#### 会话切换

- 切会话不要断开设备
- 新建会话 / 切换会话时应清空浏览器侧权限 grant cache，避免旧会话授权串到新会话

### 设置面板行为

- 设置不再是输入中自动保存
- 当前规则是：**关闭控制台 / 设置抽屉时保存**
- 不要再改回输入框 blur 或 debounce 自动保存
- 设置面板已经改成和其他控制台卡片一致的 `CardTitle + CardDescription` 结构，不要再退回旧式普通标题
- 模型上下文策略、桥接配置、语音配置等都遵循同一条规则：**关闭抽屉后才正式生效**

### 控制台抽屉

- 控制台各栏目应尽量保持**单层滚动**
- 外层统一滚动时，要继续保留美化后的滚动条样式
- 事件 / 桥接 / 波形面板不要再各自叠一层独立滚动，除非确有必要

### 响应式侧边栏抽屉

- 手机态侧边栏展开应可占据整个屏幕
- 手机态关闭按钮应和 `SheetHeader + SheetDescription` 整块竖直居中
- 不要再用字符 `×` 充当关闭图标，使用正常图标组件

### 波形库

#### 内置波形

新项目当前内置波形已按老项目对齐为以下 6 个：

- `breath`
- `tide`
- `pulse_low`
- `pulse_mid`
- `pulse_high`
- `tap`

#### 模型可见的波形信息

模型现在应当从以下位置知道可用波形：

1. 工具 schema 的 `waveformId.enum`
2. `waveformId` 参数的 description
3. `start / change_wave` 工具 description 里的波形说明

如果再出现模型说“没见到可用波形”，优先检查：

- 动态 tool definition 是否还在
- 当前波形库是否真的加载成功
- 内置波形是否被误删

### 调试建议

#### 出现“旧会话发不动，新会话可以”时

优先怀疑：

- 会话上下文被旧错误消息污染
- 会话同步存在竞态覆盖

不要先怀疑“旧会话绑定旧 API”。

#### 出现“找不到波形”时

优先检查：

- 当前内置波形是否齐全
- 模型是否拿到了动态 `enum`
- 是否是旧项目的自定义波形还没迁移到新项目

## 推荐检查命令

- Web 类型检查：`npm run typecheck --workspace @dg-agent/web`
- Runtime 类型检查：`npm run typecheck --workspace @dg-agent/runtime`
- Runtime 自测：`npm run test --workspace @dg-agent/runtime`

## 最后一句

这个项目里很多“看起来只是样式”的地方，其实都已经和用户来回确认过。

**不要想当然。先看真实页面，再做最小改动。**
