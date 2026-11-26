# 统一任务执行记录 v1

第一阶段面向主任务的执行回放和原始事件定位，适用于科研、数据处理和其他任务。

第一阶段以现有聊天页面作为验收入口。默认只在当前推理时显示动态提示，历史任务省略推理区块。在「设置 → 外观」开启「显示推理详情」后，实时与历史推理按观察顺序显示为默认折叠的区块，展开可查看包含模型标题的原文。新回复在生成时提示模型使用已保存的界面语言。用户可以为摘要明确指定语言，缺少界面语言偏好时参考对话语言。工具卡片仅显示记录到的开始时间和耗时，展开可看调用参数与结果。并行工具按开始顺序排列，即使返回顺序相反。缺少结束记录的调用显示「状态未知」。

实时使用既有 SSE，历史继续从 Pi 读取正文、附件及完整的工具结果，并以已提交事件补齐计时、相邻工具的开始顺序和缺失的工具结果。若事件无法匹配 Pi 中的调用，保留原始事件供时间线查询。每批事件写入磁盘后原子更新 `events.v1.jsonl.commit`；日志存在但找不到提交点时，保留文件并报告覆盖不完整。重启后首次读取历史或开始新运行时可记录中断，且无需重跑模型。

后续再接入文件来源定位、独立事件时间线、提交游标通知、Pi 消息级附件引用与跨进程专家事件，本阶段不以这些入口作为交付条件。

## 最小事件契约

每条记录描述一个服务端观察到的边界、片段或状态变化。`sessionId` 继续作为产品里的任务标识。一次 `/run`、一次被采纳的系统运行或一条独立系统通知有一个 `runId`；一次 `run` 可以经过多次 Pi `turn_start`，所以 `turnId` 表示其中一次模型轮次。用户中途补充由实际注入的消息定位。

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 固定为 `1`。读取器按版本和事件类型解析，未知记录要能够保留并报告。 |
| `eventId` | 采集时分配的不可变 ID。重试写入、实时事件视图、回放和引用使用同一个 ID。引用最小格式为 `{ projectId, sessionId, eventId }`。 |
| `projectId`, `sessionId`, `runId` | 由服务端按项目范围确定。沿用现有 `runId`。文件溯源用同一组标识关联。 |
| `taskSeq` | 单任务日志内递增的整数，同一任务内各次运行共享。用于排序和分页，并与现有每次运行独立的 SSE `seq` 共存。 |
| `observedAt` | 服务端收到或产生事件时的 UTC 毫秒时间。排序以 `taskSeq` 为准。 |
| `sourceAt?` | 来源明确提供与该事件对应的发生时间才填写，并记录其含义和精度。消息级时间可显示为消息时间。 |
| `source` | `pi`、`server` 或 `recovery`，说明事件由哪个层观察或产生。用户、助手及系统消息通过事件的 `role` 区分。 |
| `turnId?`, `messageId?`, `blockId?` | 由采集器按已观察到的真实边界分配。内容块优先使用 Pi 的 `contentIndex` 和 `messageId` 组成身份。归属未知时留空，并让读取端显示缺口。 |
| `type`, `payload` | 由下表约束；各事件使用固定字段和值域。 |

| 事件 | 最小载荷与语义 |
| --- | --- |
| `run_started`, `run_ended` | 起点包含 `origin: user\|system`、`kind: turn\|notice`，可带 `basePiEntryId`。终点包含 `outcome: completed\|failed\|cancelled\|blocked\|interrupted` 和可选的原因码。`completed` 表示运行正常结束。工具失败后成功重试时分别保留两次执行结果。 |
| `turn_started`, `turn_ended` | 复用 Pi 轮次边界并挂 `turnId`。一次轮次结束仍可继续调用工具、重试或进入下一轮。 |
| `message_started`, `message_chunk`, `message_ended` | 携带消息角色与稳定 ID。片段保存用户实际提交或送达的内容、助手正文和允许显示的推理，应用已有的合成提示过滤。`message_chunk` 携带 `channel: input\|text\|thinking`、内容和 `blockId`。只有能确认对应关系时才附上 Pi `entryId`。 |
| `tool_started`, `tool_ended` | 复用 `toolCallId`、`toolName` 和已知的 `parentToolCallId`。开始事件保存参数，结束事件保存可记录结果和 `outcome: completed\|failed\|cancelled\|unknown`。只收到结束时仍保留事件。`durationMs` 仅从同一进程中配对的单调时钟得到，表示实际覆盖的开始至结束间隔。 |
| `system_notice` | `code`、受控内容和已知的 `requestId` / `toolCallId`。首版覆盖已有的重试、压缩、权限请求与结果、对话中的子任务通知。中途补充在实际送达时记为用户消息。交互表单继续使用现有端点与工具结果。 |
| `record_gap` | 记录可确认的丢失、截断或写入故障。字段包括原因、受影响的运行或范围、可确定的边界。权限遮蔽、活动省略和较大内容的省略可在对应载荷上单独标记。 |

工具参数、返回、输入和大内容统一使用带状态的内容值 `inline`、`ref` 或 `omitted`，部分内容标记 `truncated` 或 `redacted`。首版可内联有界的文本及 JSON，附件沿用已确认可解析的 Pi 记录引用。无法定位引用时标为省略。落盘前使用字段白名单、脱敏和大小限制。现有 UI 的显示上限与日志保留上限独立；私有推理、凭证、完整请求头、重放快照和重复 base64 不进入日志。首版工具记录以起止为契约，详细工具进度可后续增加。

例如，一次失败工具调用可表示为以下两条记录。中间允许出现其他工具的开始、说明文字或权限事件。

```jsonl
{"schemaVersion":1,"eventId":"ev-a","projectId":"p","sessionId":"s","runId":"r","turnId":"r:1","taskSeq":12,"observedAt":1795190400010,"source":"pi","type":"tool_started","payload":{"toolCallId":"call-7","toolName":"read","args":{"kind":"inline","value":{"path":"input.csv"}}}}
{"schemaVersion":1,"eventId":"ev-b","projectId":"p","sessionId":"s","runId":"r","turnId":"r:1","taskSeq":15,"observedAt":1795190400210,"source":"pi","type":"tool_ended","payload":{"toolCallId":"call-7","toolName":"read","outcome":"failed","durationMs":200,"result":{"kind":"inline","value":"File not found"}}}
```

## 现有代码与新增部分

| 位置 | 可复用 | 第一阶段新增 |
| --- | --- | --- |
| [run-pipeline.ts](../../server/src/agent/run-pipeline.ts)、[session-observer.ts](../../server/src/agent/session-observer.ts)、[run-ids.ts](../../server/src/agent/run-ids.ts) | 运行 ID、认领与清理、用户运行和系统运行的归属、Pi 订阅、`agent_settled`。 | 在同一个运行拥有者入口记录事件，先捕获观察时间和身份再投影。覆盖启动、提前拒绝、正常完成、异常和终止。空闲通知走 `notice` 路径，保留一次。 |
| [events.ts](../../server/src/agent/events.ts)、[permissions.ts](../../server/src/agent/permissions.ts) | 现有工具和父调用 ID、权限请求 ID、系统通知白名单、路径归一化及工具展示字段。 | 从映射前的 Pi 事件取消息边界和 `contentIndex`，服务端边界走显式入口。现有 `toClientFrame` 已经丢弃部分信息，主要用来生成客户端视图。批量文本只合并同一内容块内连续片段。 |
| [run-broker.ts](../../server/src/agent/run-broker.ts)、[sessions.ts](../../server/src/api/sessions.ts) | 同一运行的 SSE 顺序、重连、实时状态与项目范围校验。 | 增加持久化写入、重启恢复和可分页读取。保留原 SSE 传输游标 `seq`。`done` 仍负责结束 SSE，真正的运行结果由 `run_ended` 表达。 |
| [session-history.ts](../../server/src/agent/session-history.ts) 和 Pi 会话 JSONL | 模型上下文、现有聊天历史、附件与已有的消息级时间。 | 按工具调用 ID 将已提交的执行观察补入 Pi 回放。保留 Pi 的正文、附件及完整工具结果。 |
| [provenance/recorder.ts](../../server/src/provenance/recorder.ts)、[provenance/store.ts](../../server/src/provenance/store.ts) | 已有工具调用 ID、运行、文件版本、环境和采集时机。 | 为后续通过 `projectId + sessionId + runId + toolCallId` 关联事件与文件步骤保留字段。 |
| [use-agent.ts](../../web/src/lib/use-agent.ts)、[chat-tab.tsx](../../web/src/components/chat-tab.tsx) | 正文和工具段落、SSE 去重、断线恢复、系统卡片和工具卡片。 | 实时与历史使用同一个聊天状态归并函数。工具结束时更新原卡片的结果、状态和耗时。 |

Pi 会话文件继续负责模型上下文、历史分支和重开对话。事件日志负责实际观测到的顺序、状态和可定位位置。文件版本与来源归因仍由 provenance 负责。后续科研专家引用事件 ID 并按需读取文件步骤。任务分支继承的 Pi 历史以继承记录展示，事件证据仍引用原任务的标识。

## 写入、读取与恢复

1. **采集顺序。** 复用运行认领，每个任务只允许一个日志写入队列，顺序在服务端观察事件时确定。不同任务之间无需建立全局顺序。已打开的运行在正常、失败、预算拒绝或取消时走同一个终结入口。认证失败、无效请求等在 `openRun` 之前拒绝的请求属于 HTTP 错误。`agent_end`、尝试重试和浏览器断连都可以发生在终结之前。
2. **持久化确认。** 在 `sandbox/.kady/runs/<sessionId>/events.v1.jsonl` 异步追加。一个写入队列负责顺序、批次及同步到磁盘，成功后才推进 `committedThrough`。`run_started`、首条用户输入、等待和结束边界触发及时冲刷；文本片段可短窗口合并。已确认序号只向前推进。文件开始创建时同步数据及平台支持的目录元数据。按次读取历史不阻塞实时发布。
3. **读取与连接。** 项目范围的 `GET /sessions/:id/timeline?after=<taskSeq>&limit=N` 返回事件、`nextAfter`、`committedThrough` 和覆盖状态。分页可固定读取上界。即时 SSE 保留现有 `seq` 去重。重开时优先接上已有运行快照，或读取带工具观察的 Pi 回放。
4. **故障与重启。** 写入失败时，聊天可继续，时间线 API 报告不完整。存储恢复后记录缺口。确认无活跃运行拥有者后，为缺少终止事件的运行追加一次 `interrupted`，无结束记录的工具状态保持未知。恢复不会触发模型重跑。当前每个项目只有一个服务进程可以写事件日志。
5. **历史兼容。** 无事件日志的任务继续使用 Pi 回放，省略空缺的计时字段。日志中无法匹配到 Pi 调用的事件可通过时间线 API 分页查看。历史全文迁移、跨进程子 Agent 逐事件采集和后台研究整理另列后续。

## 第一阶段验收

用固定的模型输出与测试工具核对实时聊天、分页读取、刷新重连以及重启后的结果。加入正文与推理的交替、并行工具、失败重试、权限决定和中途补充。

| 场景 | 通过条件 |
| --- | --- |
| 顺序与首轮可见性 | 首条用户消息在模型输出前可见。正文、推理摘要和工具保持观察顺序。连续的普通工具调用合为一个默认折叠的区块，正在执行的区块预览最近一次调用，历史区块显示调用总数。展开后可按开始顺序查看各条调用，完成后在原位置更新结果。 |
| 幂等与分页 | 断线时运行继续。重读同一页得到相同事件，聊天重连去重按 SSE 序号处理。跨运行的 `taskSeq` 继续增长，早期事件可通过 API 分页读取。 |
| 时间与状态 | 注入可控时钟，验证起止配对及刷新的耗时一致。并行开始顺序由事件序号决定。原始事件分别保留失败重试和权限决定。 |
| 重启、损坏与磁盘故障 | 进程在工具开始后中断。重新打开时保留已提交前缀、只补一次 `interrupted`，无结束记录的工具显示「状态未知」。提交点缺失时保留原日志。时间线 API 以不完整状态报告损坏的尾行或写入缺口。 |
| 旧历史 | 无事件日志的旧任务能正常打开。新旧混合任务保持 Pi 历史，工具卡片仅显示已记录的计时。 |
| 总结与结果 | 模型明确标记最终正文时，在收到该标记后折叠执行过程。其余情况等当前运行成功且最后一条助手消息包含总结。失败、中断和只有工具的任务保留过程。已记录的执行用时从本轮启动算到总结段首字，多张科研结果卡按产生顺序放在同一回复的总结后。 |
| 项目范围、内容与开销 | 交叉项目访问失败；凭证和超限内容按规则遮蔽或标记。为一个任务注入写入延迟，另一任务的 SSE 仍能前进。记录两条路径的延迟及批次大小，确认磁盘同步不在共享事件循环的同步热路径上。 |

实施顺序为 **事件采集与恢复 → 聊天实时与历史的同屏验收 → 文件步骤定位**。第一阶段验收时，发起一轮包含先行说明、相邻工具和后续回复的任务，在聊天中展开工具，记录开始时间、耗时、结果与顺序，再刷新核对。用中断夹具另验「状态未知」与旧任务兼容，用提交点缺失夹具验日志字节保留。
