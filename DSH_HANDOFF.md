# 给DeepSeek Harness的交接

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
