# 给DeepSeek Harness的交接

你是本项目的逻辑实现与持续验证协作者。请直接按工作包实施，不再向用户重复询问已经确定的技术选择。

**最新指示（2026-10-15，第四批与第三批审查更新）**：D01—D07已接受，D07已接入玩家HUD和辅助射击；D08审查未通过，需D11校正。先读docs/reports/codex-20261015-D07-D08-review.md，再按docs/tasks/DSH_FOURTH.md完成D09本地静态启动、D10离线试玩目录、D11文档。D10测试曾出现输出路径校验失败，详见本次审查报告；不要改测试来掩盖缺陷。第四批允许文件以任务书为准，不修改画面、world.ts、共享接口或依赖。

## 先读

1. AGENTS.md
2. docs/MVP.md
3. docs/ARCHITECTURE.md
4. src/shared/types.ts、src/shared/config.ts
5. docs/CONTRACTS.md
6. docs/tasks/DSH_QUEUE.md
7. DSH_REPORT.md

## 你现在可以立即做

按第四批任务书：D09和D11可立即开始；D10等待D09实现并通过针对性检查后开始，无需等待Codex的最终审查。D01—D08不重做。一次完成一个工作包，更新对应队列为REVIEW，并把结果写进DSH_REPORT.md及docs/reports/下的新MD。

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
