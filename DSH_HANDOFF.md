# 给DeepSeek Harness的交接

C27 / 2026-10-17：第二任务“断链行动”已可玩；主菜单直接选02，暂停/结算可返回选择。中继站双设施任选顺序、反应堆装甲门、60秒撤离、狩猎者级8秒开始跃迁/4秒入场/6秒火力压制，第18秒开放撤离区；两处会话检查点。空间站GLB 4676面/8批次/343600字节，现7资产。D12的39项测试已审查接受，完整237通过/4权限跳过，实际驾驶140.1秒胜利、救援炮20发；浏览器及双任务生产包通过，dist已更新。报告docs/reports/codex-20261017-C27-relay.md。无新DSH READY，下面开发中/旧数值为历史。

**最新指示 C27 / 2026-10-17：第二任务开发中。现在领取docs/tasks/DSH_RELAY.md的D12 READY，独立编写纯状态机边界与确定性测试。src/shared/relay-contract.ts及src/sim/relay-mission.ts由Codex维护，DSH只写任务书限定测试/报告，不构建、不改源码、不写Git。下方“无READY”为历史。**

C26 / 2026-10-17：已完成用户选择的建议3、4。第三波后本次任务内存检查点，失败可重试，保留损伤/僚机损失/冷却；玩家鱼雷发射/有效命中/击毁音效区分，护盾挡弹实际方向涟漪、撞舰弹开微震。完整检查194通过/4权限跳过，实际驾驶201.7秒胜利；实际浏览器重试、波形及画面验证通过，dist已更新。报告docs/reports/codex-20261017-C26-checkpoint-feedback.md。无DSH新READY任务。

C25 / 2026-10-17：战术优化完成。主炮/近防目标区分，右侧真实受击警报与3键标记威胁；Y翼鱼雷600伤害；重炮舰36伤害+每轮1机、拦截舰18伤害+每轮3机；破盾环、炮位残骸、舰桥火烟与4秒沉降淡出。完整检查190通过/4权限跳过，实际驾驶201.7秒胜利，最终浏览器与生产包验证通过，dist更新。详见docs/reports/codex-20261017-C25-tactics.md。旧条目为历史，以本条和docs/MVP.md为准；无DSH新READY任务。

C24 / 2026-10-17：已将C17—C23当前源码/模型/测试存为本地Git提交115384a（不是逐轮中间快照）。清理历史测试产物约2.04GiB；保留测试源码、node_modules、dist、public及建模资料。旧报告的截图/便携包路径可能已清理，见artifacts/README.md和docs/reports/codex-20261017-C24-cleanup.md。无DSH新READY任务。

C23 / 2026-10-17：F主动护盾5秒、开启起30秒冷却，敌方激光免伤、撞母舰/敌舰安全弹开；左下角状态和蓝色薄膜。完整检查186通过/4权限跳过，实际浏览器F键及撞舰/暂停/重开通过，dist更新。报告docs/reports/codex-20261017-C23-player-shield.md，无DSH新READY。

C21 / 2026-10-17已完成：两艘慷慨级独立护盾/舰桥/炮塔；每舰破盾一次性1Y翼+2ARC，共2Y+4ARC。Y翼320、全部ARC120、玩家100；双舰均毁胜利，单舰毁后停炮停增援。完整检查183通过/4权限跳过，实际驾驶250.9秒胜利，双舰浏览器与生产包通过，dist更新。报告docs/reports/codex-20261017-C21-dual-frigates.md；无DSH新READY任务。C17—C21改动尚未提交Git。

C19 / 2026-10-17：慷慨级外观细化，13572面/8批次/984188字节；导出与dist更新，完整检查182通过/4权限跳过，生产模型页截图已检查。详见docs/reports/codex-20261017-C19-munificent.md。无DSH新READY任务。

2026-10-17 / C17已完成：空格短程跃迁2500米/10秒，左键激光；敌舰6门可摧毁炮塔，双方舰炮实弹对轰。完整检查180通过/4权限跳过，浏览器及生产包通过，dist已更新。详见docs/reports/codex-20261017-C17-batteries.md；无DSH新READY任务。

**2026-10-17 / C16最新**：三波防守+慷慨级突袭已由Codex接入；先读docs/reports/codex-20261017-C16-frigate.md和docs/MVP.md。资产6种、阶段/配置改变，旧五波和四模型检查是历史。当前176通过/4权限跳过，暂无READY任务，不自动改视觉或回退配置。

**2026-10-16 / C07更新**：Codex按用户试玩反馈修正撞舰镜头，扩充到4友军/10敌机上限、5波46架及8座母舰炮塔。先读docs/reports/codex-20261016-C07-battle.md；仍无新READY任务，不自动开始循环。配置和D04回归摘要已由Codex调整，旧三波/7机资料属于历史版本。

你是本项目的逻辑实现与持续验证协作者。请直接按工作包实施，不再向用户重复询问已经确定的技术选择。

**最新指示（2026-10-15，第四批审查完成）**：D01—D11已接受（D08由D11及Codex修正后接受），本批无READY项，停止新增工作。先读docs/reports/codex-20261015-D09-D11-review.md和docs/DECISIONS.md。命中无独立音效、无友伤、重开直接开始均确认是首版行为，不改成缺陷。Codex修正了链接/批处理边界并补查生产包与Windows文件关联启动；4个文件符号链接用例仍因权限跳过，不修改系统设置来消除跳过。

## 先读

1. AGENTS.md
2. docs/MVP.md
3. docs/ARCHITECTURE.md
4. src/shared/types.ts、src/shared/config.ts
5. docs/CONTRACTS.md
6. docs/tasks/DSH_QUEUE.md
7. DSH_REPORT.md

## 你现在可以立即做

目前没有新实现任务。不重做D01—D11、不循环重跑测试、不自行添加玩法或工具。若用户要求继续，先读最新Codex审查报告，再执行新增且明确范围的工作包。

允许修改：src/sim/**、src/platform/**、tests/dsh/**、DSH_REPORT.md、docs/reports/dsh-*.md，以及docs/tasks/DSH_QUEUE.md中的状态/结果字段。

由Codex维护：src/shared/**、src/visual/**、src/app/**、index.html、package*.json、tsconfig.json、vite.config.ts、assets/**、public/**、游戏范围与架构文档。需要改这些文件时先把最小建议写入报告，继续其他独立任务。

## 做事方式

- 你的交付是可测试模块和故障证据；不要自行做3D模型、UI设计或截图审美评判。
- 使用TypeScript，函数参数及返回值遵守契约；每项任务一个小模块，避免搭建通用框架。
- 不添加新的npm依赖。无网络时可以用已安装依赖；纯逻辑测试可直接node --test。npm安装失败不能宣称类型检查或构建通过。
- 设置存储使用注入的StorageLike，不直接绑定window，便于无浏览器测试。
- 不更改全局代理或任何Codex/DSH个人配置。不需要API密钥。
- 不以空函数、全局any、关闭strict或删测试消除失败。
- 工作区有别人的未提交改动时保留，只编辑允许路径；默认不提交Git、不切分支。
- 做完当前批次后收束，将候选建议留给Codex，不自行增加新功能或无期限重复测试。

## 报告要求

每份报告需列：任务ID、起始Git commit、修改文件、实现行为、运行命令和退出码、用例数、已知问题、未验证项、Codex需要做的最小操作、下一项可做任务。有截图只能称“已采集待Codex检查”。

总入口DSH_REPORT.md保持最新快照；历史报告使用docs/reports/dsh-YYYYMMDD-任务ID.md，遇重名加序号，不覆盖旧证据。

## 本轮移交事实

当前已有四种低模、可玩三波护舰、镜头/HUD修正与浏览器检查；D07已接入world.interceptPoint/aimPoint，无法在弹体寿命内截击时隐藏金色提前量并提示接近目标。D08偏差由D11负责校正。真人手感、难度和真实GPU性能仍未验收。DSH不用改模型或主循环，不把HTTP检查称为视觉或完整游戏验收。
