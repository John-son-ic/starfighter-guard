# 直接发给DeepSeek Harness的提示词

2026-10-18 / C32更新：下面是第八批启动时的提示词，D13/D14现已完成并经Codex接受为DONE，当前不要重复执行；D15尚未解锁。以DSH_HANDOFF.md顶部最新指示为准。

项目目录：`C:\Users\Johnsonzinc\Desktop\sw\starfighter-guard`。将下面整段发送给DSH，或直接让它读取本文件。

---

你正在与Codex协作开发Starfighter Guard。现在开始第八批双人对战基础逻辑任务，先读AGENTS.md、DSH_HANDOFF.md最新C31说明、docs/DUEL_MODE.md、src/shared/duel-contract.ts、docs/tasks/DSH_DUEL.md。以当前文件和第八批任务为准，不执行旧队列“无READY”或D12历史指示。

游戏目标是房间码加入的1对1 Eta-2训练空战，先得3分，每轮结束双方重置；由服务器统一判定。飞行、碰撞、模型、界面、客户端预测与联网集成都由Codex负责。你现在只做D13和D14，不需要等待Codex写飞行模块。

按顺序完成：

1. D13：根据冻结类型和任务规则实现src/sim/duel-room.ts，新增tests/dsh/duel-room.test.mjs。覆盖准备/倒计时、击毁计分、双死平局、轮间、3分胜利/超时、离开/断线和重赛。
2. D14：实现src/platform/duel-protocol.ts，新增tests/dsh/duel-protocol.test.mjs。严格校验客户端JSON消息、UTF-8字节限制、字段/范围和纯令牌桶。不建立WebSocket连接。

开始先git status --short和git rev-parse HEAD，只读核对已有文件。实现只导入共享类型/常量，使用Node内置test runner；不得依赖DOM、Three.js、实际时间、网络或随机状态。不要改共享契约、设计、前端、模型、既有模块、其他测试、package/lock/tsconfig或CI；不安装依赖、不构建、不导出资产、不修改系统/用户代理、不做Git写入或上传。你可以改的完整清单以docs/tasks/DSH_DUEL.md为准。

如果接口或规则存在矛盾，写进报告并继续独立任务，不通过修改契约、放宽验证、any、删断言、跳过失败测试或写替代模拟来宣称通过。Codex未提交的设计和类型是本批有效输入，不能因为git log没显示就忽略。不要覆盖他人的写入。

分别执行node --test tests/dsh/duel-room.test.mjs和node --test tests/dsh/duel-protocol.test.mjs。最后可合并运行两个文件并执行一次npm.cmd run typecheck，记录真实命令、退出码、用例数与跳过原因。完整npm run check和双浏览器视觉验收留给Codex。

每项完成后在docs/tasks/DSH_DUEL.md末尾状态表写REVIEW，新增docs/reports/dsh-20261018-D13.md或D14.md（重名加序号），更新DSH_REPORT.md顶部当前批次摘要。报告必须包含起始/结束HEAD、修改文件、实现规则、验证证据、已知问题、未验证项和Codex下一步最小操作。不要自行判定DONE，不把纯逻辑测试说成联机成功。

D13/D14都完成后停止本批。D15未解锁；即使Codex额度中断也不自动实现服务器、飞行或UI，不无限循环测试。

最后用短消息告诉我：D13/D14状态、报告位置、测试结果、是否有需要Codex定夺的问题。

---

## DS完成后发给Codex

> DS已完成第八批。请读取DSH_REPORT.md、docs/tasks/DSH_DUEL.md和对应报告，独立审查D13/D14代码及边界测试，运行集成检查后决定是否接受，再按docs/DUEL_MODE.md继续C32—C35。不要只凭DS报告判定完成。
