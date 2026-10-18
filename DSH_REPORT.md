# DSH最新报告

## Codex验收更新 / C34 / 2026-10-18

D15已读取完整测试及报告，独立重跑10/10通过，接受DONE。快照每3tick、传输层关闭差异和过载浮点余量均符合既定行为，不改游戏服务。审查发现open等待原先缺显式超时，Codex增加AbortSignal.timeout(3000)，其余断言保留。Codex随后接入双人UI并实际验证开发/生产两页面、真实输入交战与退出结算，报告docs/reports/codex-20261018-C34-duel-client.md。DSH本批结束，无新READY；下面REVIEW是原始自测快照，不重复执行。

## DSH 第九批（2026-10-18 / D15 联机服务独立黑盒回归）

D15 已完成自测并置 **REVIEW**，本批停止等待 Codex 审查。未改服务端、共享契约、其他测试、依赖、配置、资产、脚本或图形；未构建、未导出资产、未部署、未公开监听、**未做任何 Git 写入**。

- 起始/结束 HEAD：`4ee85eec86037343b033c550e732cda0fa856afe`（**相同**，未变化）
- 任务来源：docs/tasks/DSH_DUEL_SERVER.md（入口 DSH_HANDOFF.md C33）；接口 docs/DUEL_SERVER.md；D13/D14 已 DONE，本批未重做

### 改动文件

| 文件 | 说明 |
| --- | --- |
| tests/dsh/duel-server-regression.test.mjs | 新建，10 个独立黑盒用例（唯一新增代码） |
| docs/reports/dsh-20261018-D15.md | 新建，本项独立报告 |
| docs/tasks/DSH_DUEL_SERVER.md | 状态表 D15 → REVIEW |
| DSH_REPORT.md | 本段摘要 |

### 验证结果（真实命令与退出码）

| 命令 | 退出码 | 用例数 |
| --- | --- | --- |
| `node --test tests/dsh/duel-server-regression.test.mjs` | **0** | 10 通过 / 0 失败 / 0 跳过，约 875ms |
| 同命令连续运行 3 次 | **0 / 0 / 0** | 三次均为 10/10，0 跳过 |
| `npm run check` | **未运行** | 按要求留给 Codex 集成执行 |

全部用例使用真实 `ws` 客户端、真实 127.0.0.1 临时端口与真实 HTTP 升级；除自动模式一例外均为 `automatic:false` + 注入冻结时钟。每项等待上限 3 秒，`t.after` 关闭客户端与服务。

### 覆盖要点（任务书 7 项）

1. 固定时钟下同一连接 6 次 `join` 不存在房间各扣 20（`6×20=120`），第七次 `fatal rate-limited` 并关闭；`stats().connections` 全程为 1，证明是同一连接而非六个会话。
2. 基础费用实测为 1：120 个 ping 恰好耗尽，第 121 个被限流；无效消息同样计费——60 条无效 + 60 个 ping 耗尽同一额度后限流（若无效消息免费则应剩余 60 令牌）。
3. 分片合计 10000 字节（上限 8192）关闭连接（实测 **1009**）；非法 UTF-8 文本帧关闭（实测 **1007**）；二进制帧收到 `invalid-message` fatal 后关闭（实测 **1008**）。同服务器的健康连接仍能 ping 并继续收到房间快照，房间未受影响。
4. 倒计时中对方 `leave`：快照回 `waiting`、`flight=null`、`roundId=0`、保留 `matchId`、比分仍 `[0,0]`、剩余者 ready 被清；替换者加入后双方重新准备得到 `matchId=2`、`roundId=1`、零比分、`flight.tick=0`、双方 100 血、`lastProcessedSeq=0`、无残留弹体。
5. 显式 `allowedOrigins` 后服务自身地址与缺失 Origin 均 403，拒绝握手不占 `connections`/`rooms`/`reserved`；`maxConnections:2` 下 4 个并发升级恰好接纳 2 个、其余 503，关闭后可再接纳。
6. 队列填满 6 帧后 seq 7/8 得 `input-queue-full` 且 `queuedInputs` 仍为 6；推进 6 tick 后 ack 停在 6；重提 seq 7 并在下一个 20Hz 广播点观测到 ack=7，证明被拒 seq 从未记账。旧 round/旧 match 得 `stale-input`，伪造 position/health/score 得 `invalid-message`，`serverTick`、比分与 ack 均不变。
7. 自动模式注入时钟从 0 跳到 1000ms：一次真实定时器唤醒后 `serverTick=5`、`droppedSteps=54`（区间断言 50..60 以避开浮点取整）；客户端连发消息不推进 tick。`close` 在前/后/中/失败 listen 四种时机均安全，端口释放可重新绑定；构造与 import 不监听、不装定时器，close 后推进时钟 tick 不再增长。

### 已知问题 / 观察

1. **快照按每 3 tick（20Hz）广播**：等待某个 ack 出现在快照里必须推进到下一个广播点，否则读到旧快照（我首次运行即踩到，已修正测试节奏，服务端行为正确）。
2. **连续 3 次无效消息会关闭连接**且有效消息重置计数，故「无效消息计费」只能与有效消息交替验证。
3. **传输层与应用层拒绝不同**：超限/非法 UTF-8 由 `ws` 直接关闭（1009/1007，无应用 error），二进制帧则先收到应用 `error` 再以 1008 关闭。测试只断言「连接关闭」，不断言具体码。
4. **`droppedSteps` 对浮点取整敏感**：1000ms 积压得到 59 个可用 tick 而非 60（实测丢弃 54）。测试用区间；若要精确值需服务端改整数累加器。
5. **慢消费者 256KiB 保护仍未实测**（任务书明确不要求强造 `bufferedAmount`）。
6. **心跳未重复**：既有 `tests/duel-server.test.mjs` 已用真实 ping 无 pong 覆盖，本批刻意不复制。

### 未验证项

- 未运行 `npm run check`；本段不代表全仓类型检查、全量测试、资产校验或构建通过。
- 未做浏览器、房间 UI、客户端预测/插值、模型或视觉验证——**当前仍不是可双人试玩版本**。
- 仅单机 `127.0.0.1`；未验证局域网、`0.0.0.0`、WSS/HTTPS、反向代理后的 Origin。
- 未做真实慢消费压测；未做分钟级内存/句柄/定时器浸泡（只验证 close 后 tick 停止与端口可复用）。
- 未验证异常网络（半开连接、突发 RST）下的清理时序；未重复 `maxRooms`/`server-full` 等既有覆盖。

### Codex 下一步最小操作

1. 独立审查 `tests/dsh/duel-server-regression.test.mjs`（确认不依赖服务内部结构、无伪造状态）。
2. 集成时执行 `npm run check`，确认该文件被 `scripts/test.mjs` 收集并通过。
3. 若要把 ws 关闭码纳入门禁，先固定 ws 版本策略；当前测试刻意不绑定 1007/1008/1009。
4. 慢消费者与心跳的独立压测、局域网/WSS、浏览器双端验收留待 C34/C35。

### 本批状态

D15 REVIEW。D13/D14 已 DONE 未重做。本批停止：不实现 C34 前端、不改服务端、不部署、不循环重跑。

## Codex移交更新 / C33 / 2026-10-18

本机服务已实现并验证，完整检查345项/341通过/4个Windows权限跳过。新增D15现为READY，执行docs/tasks/DSH_DUEL_SERVER.md，接口见docs/DUEL_SERVER.md，提示词DSH_SERVER_PROMPT.md。D13/D14保持DONE；本条是新任务移交，不是DSH已完成D15的报告。下方C32“D15仍未解锁”为历史。

## Codex验收更新 / C32 / 2026-10-18

D13/D14已读取源码、独立重跑61项并结合双机模拟做集成，接受为DONE。完整npm.cmd run check退出0，329项中325通过、4个Windows文件符号链接权限跳过。报告所列规则疑问均确认是既定行为，无需DSH返工；结论见docs/reports/codex-20261018-C32-duel-core.md。Codex完成共享模拟/舰体碰撞/快照，服务端和前端尚未实现；纯逻辑通过不代表联机成功。D15仍未解锁，DSH本批停止，无新READY。下面REVIEW为原始交付快照。

## DSH 第八批（2026-10-18 / D13—D14 双人对战基础逻辑）

D13、D14 已完成自测并置 **REVIEW**，本批停止等待 Codex 审查。未改共享契约、前端、模型、既有模块、依赖或其他测试；未安装依赖、未构建、未导出资产、未部署、**未做任何 Git 写入**。

- 起始/结束 HEAD：`4ee85eec86037343b033c550e732cda0fa856afe`（**相同**，未变化）
- 任务来源：docs/tasks/DSH_DUEL.md（入口 DSH_HANDOFF.md C31）；设计 docs/DUEL_MODE.md；类型 src/shared/duel-contract.ts（Codex 提供，未修改）
- 执行期间 Codex 并行新增 `src/shared/duel-snapshot.ts`、`src/sim/duel-collision.ts`、`src/sim/duel-math.ts`（C32 在途），DSH 未触碰

### 改动文件

| 文件 | 说明 |
| --- | --- |
| src/sim/duel-room.ts | 新建 13,677 B：房间/准备/倒计时/回合/计分/离开/重赛纯状态机 |
| tests/dsh/duel-room.test.mjs | 新建 27,648 B：28 用例 |
| src/platform/duel-protocol.ts | 新建 8,561 B：客户端消息严格解码 + 纯令牌桶 |
| tests/dsh/duel-protocol.test.mjs | 新建 23,630 B：33 用例 |
| docs/reports/dsh-20261018-D13.md、-D14.md | 新建，本项独立报告 |
| docs/tasks/DSH_DUEL.md | 末尾状态表 D13/D14 → REVIEW |
| DSH_REPORT.md | 本段摘要 |

### 验证结果（真实命令与退出码）

| 命令 | 退出码 | 用例数 |
| --- | --- | --- |
| `node --test tests/dsh/duel-room.test.mjs` | **0** | 28 通过 / 0 失败 / 0 跳过，约 115ms |
| `node --test tests/dsh/duel-protocol.test.mjs` | **0** | 33 通过 / 0 失败 / 0 跳过，约 101ms |
| `node --test tests/dsh/duel-room.test.mjs tests/dsh/duel-protocol.test.mjs` | **0** | 61 通过 / 0 失败 / 0 跳过，约 102ms |
| `npm.cmd run typecheck` | **0** | `tsc --noEmit` 无错误 |

**未运行 `npm run check`**（任务书要求由 Codex 集成时统一执行；DSH 并行期间不构建、不导出资产）。故本段**不代表**全仓测试、资产校验或构建通过，也**不代表联机可用**——当前没有可玩的联机模式。

### 覆盖要点

- **D13**：初态与 code 字母表；connectionId/value/reason/deadSlots 运行时校验（非法 RangeError、未知 type TypeError、校验先于终态）；深冻结输入不变；join 顺序（already-member → room-full → room-busy）与首空槽；单人准备不足/同值不重复/双准备开局一次；倒计时第 180 tick 精确切换且不越步；单死给幸存者加分、双死平局且 deadSlots 升序；间歇不重复计分、第 300 tick 开下一轮；3 分胜利；36000 临界按比分、同分平局；**最后一 tick 得 3 分优先于超时**；同 tick 事件顺序 round-ended → match-finished；倒计时离开取消开局、战斗中 leave/disconnect 判负、结算后离开不重发 match-finished、最后一人关闭保留比分；新成员加入已结算房间清结果并保留 matchId；重赛 matchId+1；两房间无串数据；终态 tick 完全 no-op；601 tick 有界真实推进。
- **D14**：六种消息精确重建；`v` 必须数字 1（`1.0`/`1e0` 等同 1）；未知 type；缺字段/多字段；禁止 position/hit/victimId/connectionId/serverTick/dt/health/score；根类型限制；boolean 与数字严格不强转；1e999 → Infinity 拒绝；seq 正整数与包内严格递增（允许间隙）；frames 1..2 与 9 字段精确集；`__proto__`/`constructor`/`toString` 按额外字段拒绝且未污染原型；**UTF-8 字节边界：恰 8192 进入 schema 校验、8193 too-large**，多字节（2800 汉字）按字节判超；10 种畸形 JSON → bad-json；非 string → TypeError；两次解码互不共享且互不污染；令牌桶初值/默认 cost/耗尽/60 每秒补充/120 封顶/20ms 精确恢复/1e-9 容差/拒绝仍推进 lastMs/成本 20 准入/时钟倒退与非法 cost RangeError/两连接独立/冻结输入。

### 已知问题（需 Codex 定夺）

1. **D13 `deadSlots=[0]` 语义**：按「槽位号」实现为 **槽 1 得分**（`scores[1]+1`、`round-ended.winner=1`），依据同句「winner 为该回合获分 slot」与「死者不能得分」。若原文「1号」指 P1（槽 0），语义相反，请明确。
2. **D13 离开判负时 `matchTicks` 保留**（契约只规定 `phaseTicks=0`），`scores`/`roundId` 同样不变；若需清零请改契约。
3. **D13 leave 清除双方 ready**（含 finished 阶段）：结算后一人离开，剩余者需重新准备。
4. **D13 不可达分支**：构造状态中双方均 ≥3 分时按槽 0 优先，仅为确定性。
5. **D14 构造函数错误类型**由我选取为 RangeError（任务书只对 consume 明确）。
6. **D14 满桶先封顶再扣费**：`tokens=120` 时亚秒补充被丢弃（满桶 `+10ms`、cost 20 → 100 而非 100.6）。严格按任务书公式。
7. **D14 `consume(s,t,undefined)` 视为省略**（cost=1）。
8. **D14 解码器需上游 `maxPayload=8192` 兜底**：字节判定会对整段文本执行 TextEncoder，超大帧的内存由传输层限制。

### 未验证项

- 未运行 `npm run check`；`typecheck` 单独通过不等于全仓门槛通过。
- **未做联机、服务器、WebSocket、浏览器、UI、视觉、飞行与碰撞验证**；纯逻辑通过不等于联机通过。
- 未验证 Codex 消费者如何消费 events（重生、清弹、出生点交换、房间页文案）。
- D13 未跑逐 tick 的完整十分钟整场（36000+ 步），阈值用构造状态精确覆盖 + 601 tick 真实推进。
- D14 未验证 `TextEncoder` 在各目标浏览器实机行为、未做 fuzz（任务书要求以边界断言为主）、未验证与 `ws` 配置联动。
- 未验证恶意/伪造 `state`（契约明确 state 来自构造函数/本模块）。

### Codex 下一步最小操作

1. 独立审查两个实现与两个测试文件，核对上文 8 条取舍；必要时修订 `docs/tasks/DSH_DUEL.md` / `docs/DUEL_MODE.md` 后告知 DSH 补测。
2. 服务端按 60Hz 每模拟步调用一次 `reduceDuelRoom(tick)`；**不得用客户端消息或 dt 推进 tick**。
3. 断线映射 `leave(reason:'disconnect')`，主动退出 `reason:'leave'`。
4. 消费 events：member-joined/left、countdown-started、round-started（重生/清弹/交换出生点）、round-ended、match-finished（含 winner=null 平局）、room-closed。
5. 每个连接独立 `DuelMessageBudget`；`create`/`join` 用 cost=20，其余（含无效消息）默认 1；先按字节拒收超限包再解码。
6. 服务层自行实现：跨包 seq 单调、match/round 归属、输入队列上限 6 帧、250ms 超时中性输入、慢消费者断开。
7. 集成时执行 `npm run check`，确认两个测试文件被 `scripts/test.mjs` 收集。

### 本批状态

D13 REVIEW、D14 REVIEW、D15 BLOCKED（未解锁，未触碰）。本批停止，不自行推进 C32—C35，不实现服务器/飞行/UI，不循环重跑测试。

## Codex验收更新 / C27

D12已独立审查、重跑39项并纳入完整检查（241项中237通过、4权限跳过），状态改DONE。第二任务实际飞行、建模、UI和生产包由Codex另行验证。观察项均已判定，见docs/reports/codex-20261017-C27-relay.md。无新READY任务，DSH本批停止。

## DSH 最新（2026-10-17 / D12）

第二任务「断链行动」纯状态机回归完成，状态 REVIEW，等待 Codex 审查。本批只新增一个测试文件，未改 `src/**`、未构建、未做 Git 写入。

- 任务：D12（docs/tasks/DSH_RELAY.md），入口 DSH_HANDOFF.md C27
- 起始Git commit：223479e（执行时 HEAD 未变，Codex 第二任务改动尚未提交）
- 被测对象：`src/sim/relay-mission.ts`（Codex 维护，已落盘，**未修改**）；类型与常量取 `src/shared/relay-contract.ts`
- 新增文件：`tests/dsh/relay-mission.test.mjs`（39 个行为用例，唯一新增代码）
- 报告：docs/reports/dsh-20261017-D12.md
- 命令 / 退出码 / 用例数：`node --test tests/dsh/relay-mission.test.mjs` → **退出码 0**，tests 39 / pass 39 / fail 0 / skipped 0，约 120ms，连续 3 次一致
- **未运行 `npm run check`**（任务书要求 Codex 合并时统一执行，DSH 并行期间不构建、不导出资产）——故本快照不代表全仓类型检查/全量测试/资产校验/构建通过
- 覆盖要点：初态；8/24/60/8/4 常量；dt 与 activeEnemies 校验；approach 条件与 checkpoint 一次；单设施不足；双设施同帧双事件；三目标同帧不跨阶段；24s 增援（2 机/8 上限/满员仍重置计时/不追补）；通讯冻结与恢复续计；反应堆毁后 escape 与追击机补足 4；8s 救援一次；12s 起且 atExtraction 才胜；60s 超时优先（含恰在 60s 到达）；四阶段死亡优先；终态稳定不重发；dt=0 语义；输入与 state 不变；无时钟/DOM/随机/网络（源码扫描）；同种子确定性与有界长序列（上限 100000 步）
- **执行期间 Codex 修改了被测模块**：`relay-mission.ts` mtime 21:47→21:53，玩家死亡分支增加 `phaseTime:0`，正好修掉我初稿列为「已知问题 1」的两条失败路径不一致；已按最终版本复核并新增断言固定该统一行为。期间一次运行撞上写入中途而短暂非 0，写入完成后连续 3 次全通过
- 其余待 Codex 决定的观察项：①`reinforcementTime` 也随阶段转换归零（契约只写 `phaseTime`）；②终态仍校验非法 activeEnemies；③reactor 增援分支正常玩法不可达，已用构造状态覆盖 1 例；④边界统一 `+1e-9` 含等号
- 未验证：未做浏览器/画面/飞行/UI/声音/GPU；未验证 `src/app/game/relay-world.ts` 的 app 集成与事件消费顺序；未跑全仓门槛；被测模块后续若再改动需重跑本文件

## Codex补充（2026-10-17 / C16）

三波+敌舰突袭已接入，报告docs/reports/codex-20261017-C16-frigate.md。配置及对应回归已由Codex更新：三波24、种子1摘要cebbfa2a、六模型资产/发布测试；完整176通过/4权限跳过。无新DSH任务。下文旧五波/四模型为历史，不覆盖当前MVP。

## Codex补充（2026-10-16 / C07）

用户试玩后授权扩充五波46架、4架友军和母舰炮塔。Codex完成碰撞镜头与战斗接入，更新配置、文档及对应测试；tests/dsh/regression.test.mjs的种子1摘要从e67c7fa0更新为84e96e70，理由见docs/reports/codex-20261016-C07-battle.md。DSH原模块没有重写，没有新READY项。下文为此前版本的历史验收信息。

## Codex验收更新（2026-10-15）

D01—D11已审查接受，D08由D11及Codex修正覆盖。详情先读docs/reports/codex-20261015-D09-D11-review.md。全仓npm run check退出0，166项中162通过、4个文件符号链接用例因权限跳过；目录联接有实际通过证据。生产包和Windows文件关联启动已补测，未冒充真人双击或物理断网。三处首版行为已确认：无独立命中音效、无友伤、重开直接开始。无READY任务，DSH完成本批后收束。

## 以下为DSH原交付快照（历史自测结果，优先以上述验收更新为准）

状态：D01—D06 已由 Codex 审查接受；D07 已接受并**接入游戏**（`world.ts` 使用 `solveIntercept`），D08 判为需修改并交由第四批 D11 校正。第四批 D09 本地静态启动、D10 离线打包、D11 说明校正已完成自测并置 REVIEW，等待审查。**本批到此停止，不再自动续加任务。** 无 BLOCKED 项。

- 任务ID：D01 任务状态机、D02 伤害与武器状态、D03 设置存储、D04 有界确定性回归、D05 有界帧时间统计、D06 导出模型文件一致性检查、D07 精确匀速截击点求解（以上已接受，D07 已接入）；**D08 试玩说明（Codex 判 REVIEW 需修改，已由 D11 校正）、D09 本地静态启动、D10 离线试玩目录打包、D11 说明校正（REVIEW）**
- 起始Git commit：dd98f16（第四批任务书基线；执行期间 Codex 推进到 846aed1 并接入 D07，DSH 未做 Git 写入）
- 完成日期：2026-10-15，Asia/Shanghai
- 环境：Windows，Node v24.16.0，npm 11.13.0
- 已完成：11/11 自测通过。D01—D07 状态 DONE（Codex 接受）；D08 由 D11 取代校正；D09、D10、D11 状态 REVIEW
- 入口：本批任务来自 DSH_HANDOFF.md 指向的 docs/tasks/DSH_FOURTH.md

## 修改文件（DSH 全部交付）

| 文件 | 任务 | 说明 |
| --- | --- | --- |
| src/sim/mission.ts | D01 | 波次/结果纯状态机：createMission、advanceMission |
| src/sim/combat.ts | D02 | 伤害与武器纯函数：applyDamage、createWeapon、advanceWeapon |
| src/sim/intercept.ts | D07 | 精确匀速截击点求解：solveIntercept（二次求根 + 线性退化 + 代回自检） |
| src/platform/settings.ts | D03 | 注入 StorageLike 的版本化设置读写：loadSettings、saveSettings |
| src/platform/frame-stats.ts | D05 | 有界帧时间统计：createFrameStats（环形缓冲、nearest-rank p95） |
| scripts/verify-assets.mjs | D06 | 导出模型一致性检查：verifyAssets + CLI（只读，退出码 0/1） |
| tests/dsh/mission.test.mjs | D01 | 20 个行为用例 |
| tests/dsh/combat.test.mjs | D02 | 16 个行为用例 |
| tests/dsh/settings.test.mjs | D03 | 16 个行为用例 |
| tests/dsh/regression.test.mjs | D04 | 11 个有界确定性回归用例 |
| tests/dsh/frame-stats.test.mjs | D05 | 14 个行为用例 |
| tests/dsh/assets.test.mjs | D06 | 21 个行为用例 |
| tests/dsh/intercept.test.mjs | D07 | 16 个行为用例（含代回校验） |
| scripts/serve-release.mjs | D09 | 本地静态服务器 + CLI：createReleaseServer、resolveRequestPath、parsePortArgument |
| start-play.cmd | D09 | 双击启动入口（用脚本自身目录，支持含空格路径） |
| tests/dsh/release-server.test.mjs | D09 | 14 个行为用例（12 通过、2 平台跳过） |
| scripts/package-release.mjs | D10 | 离线打包：packRelease、listPackageFiles |
| tests/dsh/package-release.test.mjs | D10 | 10 个行为用例（9 通过、1 平台跳过） |
| docs/OFFLINE_RELEASE.md | D10 | 离线包说明（同时作为包内 README.md） |
| docs/PLAYER_GUIDE.md | D08/D11 | 中文试玩说明（第四批按最新实现校正） |
| docs/MANUAL_CHECKLIST.md | D08/D11 | 人工检查表 68 项，记录列全部留空 |
| docs/tasks/DSH_QUEUE.md、DSH_NEXT.md、DSH_THIRD.md、DSH_FOURTH.md | 全部 | 状态与结果字段 |
| docs/reports/dsh-20261015-D01.md … -D11.md | 全部 | 十一份独立证据报告 |
| DSH_REPORT.md | 全部 | 本快照 |

未修改 src/shared/**、src/visual/**、src/app/**（含 world.ts）、index.html、package*.json、tsconfig.json、vite.config.ts、assets/**（均为 Codex 维护范围）。**未做任何 Git 写入。** D06 只读打开 public/models 下的 manifest 与 4 个 GLB，未改写。D10 只读复制 dist 与两个脚本到 artifacts/local/release（Git 忽略目录），未移动或删除任何源文件。

## 测试命令 / 退出码 / 用例数

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --test tests/dsh/mission.test.mjs` | 0 | pass 20，fail 0 |
| `node --test tests/dsh/combat.test.mjs` | 0 | pass 16，fail 0 |
| `node --test tests/dsh/settings.test.mjs` | 0 | pass 16，fail 0 |
| `node --test tests/dsh/regression.test.mjs` | 0 | pass 11，fail 0；连续 3 次 digest 一致 |
| `node --test tests/dsh/frame-stats.test.mjs` | 0 | pass 14，fail 0 |
| `node --test tests/dsh/assets.test.mjs` | 0 | pass 21，fail 0 |
| `node --test tests/dsh/intercept.test.mjs` | 0 | pass 16，fail 0（每个被接受的解均通过 `point == target + v·t` 与 `\|point − shooter\| == s·t` 代回校验） |
| `node --test tests/dsh/release-server.test.mjs` | 0 | pass 12，fail 0，**skipped 2**（符号链接用例：本机不允许创建符号链接） |
| `node --test tests/dsh/package-release.test.mjs` | 0 | pass 9，fail 0，**skipped 1**（同上） |
| `node scripts/verify-assets.mjs` | 0 | `verified 4 models, 533812 bytes` |
| `node scripts/serve-release.mjs`（真实 CLI） | 0 | `/`=200 text/html、`/?mode=models`=200、`/models/manifest.json`=200 application/json、`/nope.js`=404、`POST /`=405；停止后端口释放无残留进程 |
| `node scripts/package-release.mjs`（真实打包） | 0 | `artifacts/local/release/pack-NA8opR`，16 文件、1256765 字节 |
| `npm test`（全仓，`npm run check` 的测试阶段） | 0 | tests 157，pass 154，fail 0，skipped 3 |
| `npm run check`（集成门槛：tsc + 测试 + assets:verify + build） | **0** | tsc --noEmit 通过；157 项中 154 通过 0 失败 3 跳过；`verified 4 models, 533812 bytes`；vite build 通过 |
| `npx tsc --noEmit --ignoreConfig ...`（DSH 五个模块，严格选项） | 0 | 独立确认 DSH 范围类型正确 |

**交付后复核**：D01—D04 完成后重跑时 20/16/16/11 用例各自通过、`npm run check` 退出码 0（当时 70 用例）；D04 的 seed 1 digest 复核为 `e67c7fa0`，与记录基线逐位一致。D05/D06 加入后 105 用例通过；D07 加入后 128 用例通过；**第四批加入后**157 项中 154 通过 0 失败 3 跳过，`npm run check` 仍为退出码 0。复核均在未设置 NODE_OPTIONS 的标准环境下执行，未使用任何沙箱绕过参数。

计数口径：Codex 审查已明确 **`npm test` 为唯一用例计数入口**，无需为直接 `node --test` 的发现差异重命名运行器（该差异来自 Node 把 `scripts/test.mjs` 也当测试文件执行）。

全仓 157 用例的构成（第四批时点实测逐文件计数；**D12 未重跑全仓，故此为历史数值，未包含 D12 的 39 项**）：**DSH 贡献 138 项**——D01 20、D02 16、D03 16、D04 11、D05 14、D06 21、D07 16、D09 14、D10 10；其余为基线 3 项与 Codex 的 tests/models.test.mjs 4、tests/flight-world.test.mjs 6、tests/flight-campaign.test.mjs 1、tests/intercept-integration.test.mjs 5。**3 项跳过全部是符号链接用例**（D09 两项、D10 一项），原因是本机权限不允许创建符号链接。

## 关键实现结论

1. **D01**：判定顺序、事件一次性、每步最多一次阶段转换、ID 规则（`wave-{波号}-enemy-{序号}`）、spawn 当步不计杀、dt=0 语义均按 docs/CONTRACTS.md 实现并逐项覆盖。
2. **D02 修复一处真实数值缺陷**：武器冷却按 1/60 步递减 9 次后余 `2.08e-17`，原 `cooldownSeconds === 0` 判断使每发子弹晚一帧，射速随帧率漂移：实测射击间隔为 10 步（0.1667 秒）而非 9 步（0.15 秒），首次过热被推迟到第 12 发／第 110 步（修复后为第 11 发／第 90 步）。已用模块内 1e-9 容差把耗尽的冷却归零；修复后射击固定在 0/9/18/27/36… 步。未放宽任何校验、未改公共 API。修复前**仍会过热**，只是更慢——D02 报告已按 Codex 审查意见改为只陈述可复现的步号与热量数据。
3. **D03**：坏 JSON、null、数组、旧版本、字符串数值、错误 quality、getItem/setItem 抛错全部安全回退；写入只含四个约定字段。用 Proxy 断言模块不读取约定外字段（含私密字段）。
4. **D04**：单一 32 位 PRNG（mulberry32，内联无新依赖）驱动整局模拟；每步断言敌机上限、ID 唯一、生命与热量区间；种子 1 的 digest 基线为 `e67c7fa0`，跨进程可复现。D04 未发现 D01—D03 缺陷。
5. **D05**：`Float64Array` 环形缓冲只保留最新 capacity 条（默认 300，允许 1..10000）；`push` 只接受有限正数，其余静默忽略且不扰动窗口；空样本五项全 0；p95 用 nearest-rank `ceil(n × 0.95) - 1`；`fps = 1000 / meanMs`；`summary()` 返回新快照，改它不影响内部数据。
6. **D06**：只读校验 manifest 与 4 个 GLB 的声明一致性——ID 集合、裸文件名（硬拒路径穿越）、GLB magic／版本 2／头部长度／JSON chunk、accessor 面数、scene 中 mesh 节点数、文件字节数；CLI 失败输出「文件 + 原因」并退出 1，成功打印 `verified 4 models, 533812 bytes` 并退出 0。测试夹具建在 `artifacts/local/assets-test-<pid>/` 并于 `after` 钩子清理，`public/models` 原件未改。
7. **D07**：解 `|r + v·t|² = s²·t²` 取**最早非负根**；`a ≈ 0`（目标速率等于弹速）退化为线性式直接求解；用 `q = −0.5·(b + sign(b)·√D)` 的稳定形式避免相减抵消；根算完后做**代回自检**，偏差超容差即返回 null 而不伪装成命中；射手与目标重合返回 `time = 0`；越 `maxTime`（默认 2 秒，与弹体寿命一致）返回 null，边界含等号。无解用例不仅断言 null，还用独立求根复核几何（判别式为负，或无根落在 `[0, maxTime]` 内）。
8. **D08→D11**：`docs/PLAYER_GUIDE.md` 与 `docs/MANUAL_CHECKLIST.md`（第四批校正后 A—H 共 68 项，记录列全部留空）。Codex 判定 D08「暂不接受、REVIEW 需修改」并列出 6 处偏差，D11 逐条修正并附代码位置：命中敌机**无独立音效**（受击音效只对应自己被击中）、**不存在友军伤害**（`updateBolts` 直接跳过同队）、重开**直接进入 playing** 而非回简报、提前量方位/命中/击毁不是必然结果、补齐新 HUD（屏外三角箭头、母舰青色定位、锁定目标血条、提前量虚线、遮挡隐藏、准星右下目标读数）、暂停清空输入与低画质 0.75 像素比。D11 另自行排查出 6 处矛盾，其中最重要的是 **D07 已接入**（`world.ts` 用 `solveIntercept`，无解时隐藏提前量并提示“暂无有效截击点 · 接近目标”），说明据此改写为精确匀速解而非近似估算。
9. **D09**：`scripts/serve-release.mjs` 仅用 Node 内置模块，`createReleaseServer` 返回未 listen 的 server、import 无副作用；默认根为脚本旁的 `../dist`（不依赖 cwd）、端口 5174、只绑 127.0.0.1；支持 GET/HEAD、正确 MIME（JS 可作 ES 模块）、404/405、不列目录、缺失资源不回退首页；路径限制在静态根内，拒绝越界/反斜杠/盘符/UNC/NUL/坏百分号编码，并用 `realpath` 复核符号链接、用「根 + 分隔符」段前缀而非字符串 startsWith 判断兄弟目录。实现中修掉自身两个缺陷：`normalize(join(root,'/'))` 保留结尾分隔符导致 `/` 被误判越界返回 403；盘符检查写成 `/^[a-zA-Z]:/` 只匹配开头，可被 `/C:/...` 绕过。
10. **D10**：`scripts/package-release.mjs` 仅用 Node 内置模块，按明确清单只复制 `dist/**`、`scripts/serve-release.mjs`、`start-play.cmd` 与说明（改名 README.md），拒绝符号链接，用 `mkdtempSync` 生成不冲突目录且不覆盖旧包；缺构建/启动器/说明即报错且**不生成目录**。真实打包结果 16 文件、1256765 字节，7 类诱饵均未进入包。修掉自身一个设计错误：初版把「输出目录位于项目内」当作禁止条件，与默认输出 `artifacts/local/release` 冲突，已改为只拒绝 dist 内输出与项目根自身。

## Codex 审查结论（2026-10-15，docs/reports/codex-20261015-DSH-review.md）

**D01—D04 已被接受，可接入游戏。** DSH 原列 6 项已知问题已全部得到决策：readonly 属调用方约束、不要求运行时冻结（问题 1）；解过热与射击可同一步、保留既定顺序（问题 2）；防御归一化可保留（问题 3）；v1 严格版本检查保留，但**浏览器集成必须捕获「访问 `window.localStorage` 属性本身」可能抛出的异常**，不能只依赖 getItem 内部捕获（问题 4，属 Codex 集成侧要求）；单个固定 digest 加多种子不变量足够（问题 5）；强制失败用于验证状态机可接受（问题 6）。冷却 epsilon 修复保留。

据此已修正 D01/D02 报告中两处过强措辞（readonly 冻结注释、热平衡用语），未改弱任何断言。计数口径已统一为 `npm test`。

## 已知问题（已写入各项报告）

1. `activeEnemyIds` 未冻结——**已决策**：readonly 是调用方约束，现策略满足契约，不增加每步冻结、不改 API（D01）。
2. 解过热与射击可在同一步发生——**已决策**：保留既定顺序（D02）。
3. `advanceWeapon` 对外部异常 state 字段做钳制而非抛错——**已决策**：可保留（D02）。
4. D03 `version` 严格 `=== 1` 无迁移逻辑——**已决策**：首版无迁移需求；但集成侧需按上条捕获 localStorage 属性访问异常。
5. D04 digest 基线只固定 seed 1；失败分支由固定步号强制触发——**已决策**：作为状态机回归足够，不作为真实战斗物理验收。
6. D05：p95 秩用浮点 `ceil(n × 0.95)`，极端 n 下理论上可能偏移 1；已固定 n=10/19/20/100 的当前行为，改口径需 Codex 明确（D05）。
7. D05：`summary()` 每次复制并排序整个窗口（O(n log n)，n ≤ 10000），未做性能声明；若每帧调用建议降低频率（D05）。
8. D06：只校验 GLB 的**声明值**，不解析 binary chunk 实际字节，因此「accessor count 与 buffer 长度不符」的坏文件不会被发现；也未强制要求 BIN chunk 存在（D06）。
9. D06：预期 ID 常量 `EXPECTED_MODEL_IDS` 固化在脚本内（与 `MVP_CONFIG.models` 一致）；模型集合变化需同步，或由 Codex 授权改为 shared 驱动（D06）。
10. D07：求解假设目标在弹体飞行期间**严格匀速直线**，目标每步转向时存在偏差；每步重算可缓解，但这不是追踪解。任务书只要求匀速解（D07）。
11. D07：`a ≈ 0` 的判定阈值为 `|a| <= Number.EPSILON * max(s², 1)`；目标速率与弹速极接近但不相等时仍走二次式，判别式接近零、两根几乎重合，靠代回自检兜底（D07）。
12. D08/D11：检查表的“是否晕”“是否易懂”依赖真人主观判断，无法自动验证；开发端口 5173、离线工具端口 5174，被占用时以窗口地址为准（D08/D11）。
13. D08/D11：**“命中敌机无独立音效”“不存在友军伤害”“重开直接进入 playing”都是据实记录的现状**，不是缺陷判定；若 Codex 认为应修复，请告知，DSH 会改为记录缺陷而非写进说明（D08/D11）。
14. D09：不记录逐请求访问日志；只映射目录自身的 `index.html`，不做 SPA 式回退；`cache-control: no-cache` 且无 ETag；端口占用只提示不自动改端口（D09）。
15. D10：包目录名为 `pack-<随机6位>`，不含版本号或日期；包是构建快照，重新 `npm run build` 后须重新打包；`dist/models/README.md` 会随 `dist/**` 一并进入包（D10）。

## 未验证项

- 全部任务均未做视觉验收、未采集截图；逻辑测试通过不代表画面、模型比例或飞行观感通过，这些由 Codex 判定。**D06 未对模型外观、比例或造型做任何判断**，也未验证 GLB 能否被 three.js `GLTFLoader` 实际加载。
- **未测量真实游戏帧率**；D05 的测试样本是构造数据，D04 的毫秒数只证明有界，均不用于推断 GPU 性能或声称性能达标。
- 未在浏览器中运行；settings 只用注入的假存储验证，未测真实 localStorage 的隐私模式/配额行为（Codex 审查特别提示的属性访问异常场景未覆盖）。
- D07 已由 Codex 接入并通过其独立验证；DSH 自身**未在真实弹体飞行中验证命中率变化**，未验证目标转向/加速的追踪场景（匀速解本身不预测转向）。
- **D08/D11 未进行任何实际试玩**；68 个检查项全部是待验证状态，未采集截图、未测帧率、未在低画质档位实跑。
- **D09 未做 Windows 双击 `start-play.cmd` 实测**；D09/D10 的**符号链接拒绝共 3 项用例因本机权限不允许创建符号链接而跳过，未取得通过证据**。
- D10 **未做断网适配验收**，未从另一台设备尝试访问（应被 127.0.0.1 绑定拒绝，未实测），未验证其他浏览器。
- `npm run check` 退出码 0 对应本报告记录的最后一次运行；Codex 若继续大幅改动 src/**，需重跑门槛。

## 阻塞

无已知阻塞。此前 `npm run check` 因 Codex 未完成的 `src/app/style.css` 与 `ImportMeta.hot` 类型而失败，Codex 已自行补齐；第四批加入 D09/D10 后门槛（含 `assets:verify`）为退出码 0（157 项中 154 通过、0 失败、3 平台跳过）。

## Codex 需处理（最小操作）

1. 审查第四批：scripts/serve-release.mjs + start-play.cmd + tests/dsh/release-server.test.mjs（D09）、scripts/package-release.mjs + tests/dsh/package-release.test.mjs + docs/OFFLINE_RELEASE.md（D10）、docs/PLAYER_GUIDE.md + docs/MANUAL_CHECKLIST.md（D11），置 DONE 或给出偏差。D01—D07 已接受。
2. D11 是 Codex 判为「D08 REVIEW 需修改」的修正交付，请重点复核其中 6 处偏差是否已按预期改对。
3. 确认上文第 13 条三处现状（命中无音效、无友军伤害、重开直接开始）是否为既定行为；若计划修复请告知。
4. 若要在允许创建符号链接的环境补齐 D09/D10 的 3 项跳过用例，请在那样的环境重跑这两个测试文件。
5. D06：`assets:verify` 已入门槛；模型集合变化时同步 `EXPECTED_MODEL_IDS`。
6. 若组织首次试玩，请把填充后的 MANUAL_CHECKLIST 结果归档到 docs/reports/ 下便于后续对比。

## 最近历史报告

- docs/reports/dsh-20261015-D01.md — 任务状态机
- docs/reports/dsh-20261015-D02.md — 伤害与武器状态（含冷却 epsilon 缺陷的可复现计时证据）
- docs/reports/dsh-20261015-D03.md — 设置存储
- docs/reports/dsh-20261015-D04.md — 有界确定性回归与移交清单
- docs/reports/dsh-20261015-D05.md — 有界帧时间统计
- docs/reports/dsh-20261015-D06.md — 导出模型文件一致性检查
- docs/reports/dsh-20261015-D07.md — 精确匀速截击点求解（含示例、误差、替换建议与集成结果）
- docs/reports/dsh-20261015-D08.md — 试玩说明与人工检查表（第三批原始交付）
- docs/reports/dsh-20261015-D09.md — 无第三方依赖的本地试玩启动
- docs/reports/dsh-20261015-D10.md — 可移动的离线试玩目录
- docs/reports/dsh-20261015-D11.md — 以最新实现校正玩家说明（含 6+6 处偏差的依据）
- docs/reports/codex-20261015-DSH-review.md、codex-20261015-D07-D08-review.md — Codex 审查与决策（他方文档）

## 下一步

**本批到此停止，等待 Codex 审查。** D09、D10、D11 已完成自测并置 REVIEW；D08 由 D11 校正。停止后不自动领取新任务、不增加工具、不做无变化循环检查、不改首版范围、不修改其他 Agent 负责的文件、不做 Git 写入。

复现入口：`npm test` 与 `npm run check` 均退出码 0（157 项，154 通过 / 0 失败 / 3 符号链接用例因本机权限跳过）；`node scripts/verify-assets.mjs` 输出 `verified 4 models, 533812 bytes`；`node scripts/serve-release.mjs` 可在 127.0.0.1:5174 提供已构建页面；`node scripts/package-release.mjs` 生成 `artifacts/local/release/pack-NA8opR`（16 文件、1256765 字节）；D04 的 seed 1 digest 为 `e67c7fa0`。DSH 未对模型外观、比例或飞行手感作任何判断。
