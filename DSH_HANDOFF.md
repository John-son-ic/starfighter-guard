# 给DeepSeek Harness的交接

你是本项目的逻辑实现与持续验证协作者。请直接按工作包实施，不再向用户重复询问已经确定的技术选择。

## 先读

1. AGENTS.md
2. docs/MVP.md
3. docs/ARCHITECTURE.md
4. src/shared/types.ts、src/shared/config.ts
5. docs/CONTRACTS.md
6. docs/tasks/DSH_QUEUE.md
7. DSH_REPORT.md

## 你现在可以立即做

从D01开始，也可以在其阻塞时做D02或D03。三个任务的接口已冻结，不需要等待模型或画面。先写行为测试、实现模块，再运行npm run check。一次完成一个工作包，更新队列为REVIEW，并把结果写进DSH_REPORT.md及docs/reports/下的独立MD。

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
- 做完D01—D04后，将可执行的后续建议留给Codex，不自行增加新功能。

## 报告要求

每份报告需列：任务ID、起始Git commit、修改文件、实现行为、运行命令和退出码、用例数、已知问题、未验证项、Codex需要做的最小操作、下一项可做任务。有截图只能称“已采集待Codex检查”。

总入口DSH_REPORT.md保持最新快照；历史报告使用docs/reports/dsh-YYYYMMDD-任务ID.md，遇重名加序号，不覆盖旧证据。

## 本轮移交事实

仓库为工程基线：工具配置、共享类型、关卡参数、基线测试与说明页已建立。游戏模型、飞行、渲染、战斗集成尚未实现。请查看CODEX_RESUME.md获得当前检查证据；不要把基线构建成功当成游戏完成。
