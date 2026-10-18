# 第八批 / 双人对战基础逻辑 D13—D14

日期2026-10-18；设计基线C31，起始已提交HEAD 4ee85ee。用户授权设计新模式及DSH协作；当前只解锁下列两个纯逻辑工作包，不解锁服务器、飞行模拟或前端。[共享接口](../../src/shared/duel-contract.ts)已落盘，玩法见[DUEL_MODE.md](../DUEL_MODE.md)。C31文档/类型可能尚未Git提交，以实际文件为准。

优先级：本任务书对本批的明确限定 > DSH_HANDOFF.md历史说明 > 旧批次队列。D12及以前全部保持原状态。以下规则若与共享类型矛盾，记录冲突，不擅自改契约。

## 文件边界与命令

只允许新增/修改：

- D13：src/sim/duel-room.ts、tests/dsh/duel-room.test.mjs。
- D14：src/platform/duel-protocol.ts、tests/dsh/duel-protocol.test.mjs。
- 公共记录：DSH_REPORT.md顶部本批摘要、docs/reports/dsh-20261018-D13.md、docs/reports/dsh-20261018-D14.md，以及本任务书末尾的状态/结果栏。报告重名时追加序号，不覆盖历史。

不改src/shared、app、visual、其他sim/platform模块、服务器、资产、依赖/锁文件、tsconfig、CI、旧测试或设计规则；不安装依赖、不构建、不导出模型、不操作Git写入、不部署。工作区即使有Codex未提交改动也只动上述文件；发现本任务文件有他方写入先停止该文件并报告，不覆盖。

使用TypeScript、Node内置测试；直接导入.ts。两个实现不得依赖DOM、Three.js、浏览器/网络、文件系统、实际时钟、全局随机或计时器；消息长度可使用Node和浏览器均有的TextEncoder，不用Buffer或node:*依赖。逻辑通过不代表联机通过。

单项完成后运行对应node --test；若类型检查失败可只读查看相关文件，不越界修。npm.cmd run typecheck可在本批完成时统一跑一次；npm run check由Codex集成时执行。本批有界测试，不设无穷循环、不sleep、不追求虚高用例数；覆盖规则和失败边界即可。

## D13 — READY：纯房间/回合/计分状态机

导出两个函数，参数与返回值类型从共享契约导入：

```ts
createDuelRoom(code: string): DuelRoomState
reduceDuelRoom(state: DuelRoomState, command: DuelRoomCommand): DuelRoomStep
```

每次调用只推进一个命令，输入对象和嵌套数组/成员不可修改。允许无变化时返回同一state；events只属于本次调用，下一次不得重复。业务拒绝返回原state、空events和error；成功error=null。无需deep-freeze输出，不引入通用状态机框架。

### 初态与校验

- code必须恰好6位，且全部来自DUEL_ROOM_ALPHABET；不自动转大小写/trim。非法抛RangeError。
- 初态phase=waiting，members=[null,null]，scores=[0,0]，matchId/roundId/phaseTicks/matchTicks全0，winner/finishReason均null。
- connectionId必须1..64位ASCII字母、数字、下划线或短横；ready.value是boolean；leave.reason只能leave/disconnect；tick.deadSlots为长度0..2且无重复的0/1数组。运行时非法字段值抛RangeError，未知command.type抛TypeError，不返回业务error；须先校验再判断终态。state来自构造函数/本模块，不要求实现通用的恶意state反序列化校验。
- 所有时间使用整数tick，不接受dt、毫秒或Date。不可从墙上时间推进模拟。

### join / ready / 离开

- closed房间对有效非tick命令返回room-closed。tick保持稳定。
- join先判重复connectionId → already-member，再判两槽已满 → room-full，再判phase非waiting/finished → room-busy；取第一个空槽。成功输出member-joined(slot)，清除双方ready。
- waiting加入不改比分/计时（正常均初始值）。finished中加入新成员后回waiting，清零比分、roundId/phaseTicks/matchTicks和winner/finishReason，保留matchId；不能把新成员自动带进旧比赛。
- ready通过connectionId找成员，找不到not-member；仅waiting/finished允许，否则not-ready-phase。同值设置不产生事件。只有两人均ready时才开新比赛：matchId+=1，roundId=1，phase=countdown，其余计时/比分/结果清零；输出countdown-started(matchId)，此时两人ready保留true。
- leave找不到成员返回not-member。找到则移除，清双方ready，先输出member-left(slot)。若无人则phase=closed、phaseTicks=0，再输出room-closed，保留已有比分/结果，不产生新的match-finished。
- waiting/countdown离开且仍有人：回waiting，比分/roundId/phaseTicks/matchTicks清零，winner/finishReason=null，保留matchId，取消开局。
- playing/intermission离开且仍有人：立即finished，winner=剩余slot，finishReason=command.reason，phaseTicks=0，不伪造3分或击杀，不更改原比分；member-left之后输出一次match-finished。
- finished离开且仍有人：继续finished，保留本场结果，不重发match-finished。剩余者可等待新成员加入，或退出。

### tick / 回合与整场

- waiting/finished/closed的有效tick是完全no-op。countdown/intermission的deadSlots也忽略，不能结算伤害。
- countdown每tick把phaseTicks加1；恰到180进入playing、phaseTicks归0，输出round-started(roundId=1)，matchTicks仍0。不在同一命令再推进playing。
- playing每tick把phaseTicks和matchTicks各加1。deadSlots=[]不结算回合；=[0]给1号一分，=[1]给0号一分，双方同tick死亡不加分。单方自撞也一样给对方得分，DSH不推断碰撞来源。
- 有死亡时输出round-ended，winner为该回合获分slot，双方死亡为null；deadSlots输出升序的新数组。随后先检查是否有人到3分，再检查matchTicks>=36000。
- 达3分：finished，winner为达分者，finishReason=score。否则到36000：finished，按更新后的比分判高分胜，同分winner=null，finishReason=time-limit。finished均phaseTicks=0、清双方ready并输出match-finished一次。若同tick既回合结束又整场结束，事件顺序为round-ended → match-finished；时间到但无人死只发match-finished。
- 有死亡但整场未结束：phase=intermission、phaseTicks=0，matchTicks保留，不增加roundId。死亡事件在这个tick已结算，后续间歇tick不重复得分。
- intermission每tick只把phaseTicks加1，不累加matchTicks；恰到300进入playing、roundId+=1、phaseTicks=0，输出round-started(new roundId)。重置飞船和清弹是Codex消费者的职责，D13不创建战机。
- phaseTicks跨阶段归0；matchTicks只在playing累加，重赛清零。finished再次ready按上述规则开始新match，旧结果不影响新比赛。新matchId是旧值+1，不把matchId重置成1。

必测：初态/校验/冻结输入；第三人拒绝和重复加入；单人准备不足/双准备/倒计时临界；3分胜利；同tick双死；间歇不重复计分和第300步开局；36000临界/同分平局/最后一tick获3分优先；准备中离开、战斗中断线、结算后离开、最后一人关闭；新成员加入已结算房间清结果；重赛matchId增加；两独立房间无串数据；终态稳定。可用构造合法state把计时设为阈值前一tick，另加有界真实推进序列，不要求跑多场十分钟。

验证：node --test tests/dsh/duel-room.test.mjs。

## D14 — READY：客户端消息解码与纯令牌桶

不依赖D13实现，可独立完成；建议先完成D13再顺序做本项。导出：

```ts
decodeDuelClientMessage(text: string): DuelDecodeResult
createDuelMessageBudget(nowMs: number): DuelMessageBudget
consumeDuelMessageBudget(state: DuelMessageBudget, nowMs: number, cost?: number): DuelBudgetStep
```

### 消息解码

- text运行时非string抛TypeError；以UTF-8字节数限制8192，超出返回too-large，等于8192仍进入解析。不得按JS字符长度冒充字节长度。先检查长度再JSON.parse；解析抛错返回bad-json。
- 合法JSON但不符合下列schema返回invalid-message，不抛异常，不补默认值、不类型强转、不丢弃额外字段。
- 所有对象只能有契约中对应消息的字段，必须完整；根不能是null、数组、数字/字符串，未知类型或v不等于数字1均拒绝。嵌套frame也严格检查键；包括__proto__/constructor等额外键均拒绝，不访问对象原型属性作为字段。
- create/leave：恰有v/type。join：再含code，房间码规则同D13，不自动trim或转大写。ready：再含value，严格boolean。ping：再含nonce，整数0..2147483647。
- input：恰有v/type/matchId/roundId/frames；matchId、roundId是1..2147483647整数；frames为长度1或2的数组。frame字段恰为seq/yaw/pitch/roll/throttle/boost/fire/torpedo/shield。seq为1..2147483647整数；yaw/pitch/roll/throttle为有限数且-1<=值<=1；其余四字段严格boolean。同包两帧seq严格递增，允许不连续；跨包旧seq和match/round不符由Codex服务层拒绝，解码器不持有会话状态。
- 成功返回独立解析出来的DuelClientMessage。不实现服务端消息解码，不创建连接，不把connectionId、位置、命中或时间步加入客户端协议。

示例：

```json
{"v":1,"type":"join","code":"ABCD23"}
{"v":1,"type":"input","matchId":1,"roundId":1,"frames":[{"seq":1,"yaw":0,"pitch":0,"roll":0,"throttle":0,"boost":false,"fire":true,"torpedo":false,"shield":false}]}
```

### 纯令牌桶

- 构造nowMs为有限且>=0的数，初态tokens=120、lastMs=nowMs。
- consume参数nowMs须有限、>=state.lastMs；cost省略为1，否则必须1..120整数。非法抛RangeError且不修改state；受信state不要求全面反序列化检查。
- available=min(120,state.tokens+(nowMs-state.lastMs)*60/1000)。available+1e-9>=cost允许，tokens=max(0,available-cost)；否则拒绝且tokens=available。无论允许/拒绝，新state.lastMs=nowMs。不四舍五入令牌，不修改输入。
- 服务层对create/join使用cost=20，其余消息/无效消息默认1；本模块只接收cost，不自行解析消息、等待、封IP或计时。每个连接独立持有状态。

必测：每种合法消息和双帧；版本/未知type/缺字段/多字段/伪造位置与命中/null/数组/错误boolean/字符串数字/溢出指数1e999/负或分数seq/包内倒序；ASCII和多字节UTF-8长度边界；畸形JSON；解码与输入互不污染；令牌用尽/精确恢复/封顶/拒绝也更新时间/成本20/时钟倒退/非法成本/两连接独立/冻结输入。不能通过大量随机样本代替边界断言。

验证：node --test tests/dsh/duel-protocol.test.mjs；两项完成可一起执行node --test tests/dsh/duel-room.test.mjs tests/dsh/duel-protocol.test.mjs和npm.cmd run typecheck，报告真实退出码。

## 后续未解锁

D15最初为BLOCKED；C33现已完成服务端并安装固定依赖，转至[第九批任务书](DSH_DUEL_SERVER.md)，状态READY。DSH只执行新任务的黑盒测试，不创建替代服务器或飞行模拟。下段“D15未解锁”是本批启动时的历史收束要求，以新入口为准。

完成D13/D14后各自状态改REVIEW，不自行写DONE。更新DSH_REPORT.md，写起始/结束HEAD（并行时可能变化）、实际修改文件、命令/退出码/用例数、问题/未验证、Codex最小集成步骤；随后停止本批，等审查。若Codex因额度中断，依然只完成这两个包，不擅自推进C32—C35。

## 状态与结果（DSH只改本节，不改以上规则）

| ID | 状态 | 结果 / 报告 |
| --- | --- | --- |
| D13 | DONE | Codex C32已读源码并独立重跑28项，接受；槽0死亡由槽1（界面P2）得分，离开保留matchTicks/比分、清双方ready，closed优先均符合契约。与真实双机模拟完成3次实际击毁、计分和重赛集成。原报告docs/reports/dsh-20261018-D13.md；验收见docs/reports/codex-20261018-C32-duel-core.md |
| D14 | DONE | Codex C32已读源码并独立重跑33项，接受；构造非法时间RangeError、先封顶后扣费、undefined成本等同省略、JSON按标准解析均符合契约。入站maxPayload和跨包序列归属仍由后续服务端负责。原报告docs/reports/dsh-20261018-D14.md；验收见docs/reports/codex-20261018-C32-duel-core.md |
| D15 | DONE | 第九批已由C34审查接受，见docs/tasks/DSH_DUEL_SERVER.md；不重复执行 |
