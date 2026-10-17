# 第七批 / 第二任务逻辑回归 D12

2026-10-17，用户批准第二关「断链行动」；结尾为狩猎者级跃迁救援。起始版本223479e。最新契约见src/shared/relay-contract.ts。Codex负责实现src/sim/relay-mission.ts及全部app/visual集成，DSH独立补逻辑测试与报告，无跨文件写入依赖。

## D12 — READY：纯状态机边界与确定性测试

允许新增/修改：tests/dsh/relay-mission.test.mjs、DSH_REPORT.md、docs/reports/dsh-20261017-D12.md、本文件的状态/结果栏。不得修改src/**、其他测试、资产、package或Git。

导入createRelayMission()和advanceRelayMission(state,dt,input)，来源src/sim/relay-mission.ts；类型/配置来源src/shared/relay-contract.ts。若模块尚未落盘，先按下列冻结契约编写测试，标记待运行，不写替代实现、不抢改Codex文件。

规则：
- 初态approach，elapsed/phaseTime/reinforcementTime=0，rescueCalled=false，lossReason=null。
- dt必须有限且0<=dt<=0.1；非法dt抛RangeError且不修改输入。input.activeEnemies须为0..8整数，非法抛RangeError。终态有效输入后稳定且不重发事件。
- 玩家死亡优先，任何阶段同帧其他成功条件不覆盖失败；lost原因player-destroyed。
- approach在patrolCleared且inStationRange时进入facilities，一次checkpoint facilities。
- facilities期间计24秒增援，通讯被毁立即停止增援计时；每次最多补2机且不超过8，满员也重置本次计时。不追补一个dt前的间隔。
- 两设施都毁才进入reactor；同帧输出reactor-exposed和checkpoint reactor，只转一次阶段，不跨到escape。
- reactor仍按同样通讯规则判断（正常两设施已毁因此不补机）。反应堆毁进入escape，phaseTime=0，escape-started，补足至少4架追击机（上限8；已有>=4不新增）。
- escape从进入后的下一步开始计时；第8秒输出一次rescue-arrival，rescueCalled=true；第12秒起且atExtraction才won。提前到达不直接胜利，需要等舰船完成4秒入场。第60秒到达也按超时失败优先，lossReason=escape-timeout。
- phaseTime仅在转换时归零，elapsed累计；输入和state均不被修改。dt=0可处理状态条件，不能推进时间。
- 暂停由调用者不调用advance实现；不使用实际时间、随机全局、DOM、Three.js、网络或sleep。

用例重点：两个设施攻击次序、只毁一个、通讯停止增援/场上上限、事件仅一次、提前撤离/救援完成/超时、死亡与胜利同帧、同种子输入确定性及有界长序列、冻结输入对象。总步数<=100000。无需测试几何、飞行、UI、声音或真实GPU。

执行node --test tests/dsh/relay-mission.test.mjs，记录退出码/用例数；Codex在合并时统一执行npm run check，DSH并行期间不要构建或导出资产。若契约不清先记录最小建议，不自行改契约。完成状态写REVIEW，报告当前HEAD、文件、证据、未验证项后停止本批。

状态：DONE（2026-10-17 Codex已独立审查并通过完整检查）
结果：已执行。新增 tests/dsh/relay-mission.test.mjs（39 用例，唯一新增文件），未改 src/**、其他测试、资产或 package，未做 Git 写入，未运行 npm run check（按要求由 Codex 合并时统一执行）。`node --test tests/dsh/relay-mission.test.mjs` 退出码 0：tests 39 / pass 39 / fail 0 / skipped 0，约 120ms，连续 3 次结果一致。契约规则逐条核对均符合：初态、8/24/60/8/4 常量、dt 与 activeEnemies 校验、approach 条件、单设施不足、双设施同帧双事件、三目标同帧不跨阶段、24s 增援与 2 机/8 上限、满员重置计时、通讯冻结与恢复续计、reactor 毁后 escape 与追击机补足 4、8s 救援一次、12s 起且 atExtraction 才胜、60s 超时优先、四阶段死亡优先、终态稳定、dt=0 语义、输入与 state 不变、无时钟/DOM/随机/网络、同种子确定性与有界长序列。执行期间 Codex 修改了 relay-mission.ts（玩家死亡分支增加 phaseTime:0，mtime 21:53:13），与本项初稿列为「已知问题 1」的不一致一致，已按最终版本复核并新增断言固定两条失败路径统一归零。其余待 Codex 决定的观察项：reinforcementTime 也随阶段转换归零、终态仍校验非法输入、reactor 增援分支正常玩法不可达（已用构造状态覆盖 1 例）、边界统一含等号。起始 commit 223479e。证据：docs/reports/dsh-20261017-D12.md。

Codex接受说明：39项独立重跑通过，完整检查241项/237通过/4权限跳过。报告中的计时清零、终态校验、不可达reactor构造用例和含等号边界均确认为既定行为。应用层撤离区在18秒激活（12秒救援完成后6秒实际压制），纯状态机的12秒下限与atExtraction契约不变。本批停止，无新READY。
