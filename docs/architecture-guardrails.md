# 架构护栏

这份文档不是介绍项目“有什么”，而是约束项目“不要重新长回去”。

## 1. 依赖方向

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

## 2. 页面层职责

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

## 3. 页面行为组织方式

页面里的非渲染逻辑，优先收敛为 hooks，而不是堆进 `App.tsx`。

当前典型职责：

- `use-browser-app-services`：浏览器依赖组装
- `use-runtime-session-state`：会话同步与 runtime 事件镜像
- `use-waveform-manager`：波形导入/编辑/删除
- `use-voice-controller`：语音输入、语音回放、voice mode

新增页面流程时，优先问自己：

1. 这是渲染逻辑，还是行为逻辑？
2. 如果它不关心 JSX，它是不是应该成为 hook？

## 4. Runtime 职责

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

## 5. Storage 职责

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

## 6. 消息与 trace 护栏

默认规则：

- `session.messages` 只保留正常聊天正文
- tool result / deny / fail / timer 等运行记录写入 trace
- timer 到期、deny/fail 后用于收口的内部提示使用 ephemeral input，不写入会话正文

禁止重新引入：

- 把内部系统提示长期持久化到 `session.messages`
- 把工具输出伪装成原始聊天消息塞回 history
- 把 trace 再塞回 `session.metadata` 做整对象覆盖保存

## 7. Bridge 职责

`packages/bridge-core` 负责：

- 桥接平台抽象
- 消息队列
- 远程权限确认
- 桥接消息路由
- 桥接状态 / 日志广播

`packages/bridge-browser` 负责：

- QQ / Telegram 等浏览器侧适配器实现

桥接相关不应直接侵入页面组件。

## 8. Provider / Device 适配层职责

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

## 9. 新功能接入规则

新增功能前先判断：

1. 它是领域逻辑、运行时逻辑，还是平台接入？
2. 它应该长在 runtime，还是应该是新的 adapter / store / hook？
3. 它会不会让 `apps/web` 知道过多底层细节？

如果答案是“会让页面知道太多”，那通常就是放错层了。

## 10. 默认优先级

实现顺序始终优先：

1. 边界
2. 模型
3. 机制
4. UI

不要反过来。
