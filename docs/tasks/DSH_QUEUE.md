# DSH执行队列

状态约定：READY可执行；DOING进行中；REVIEW自测完成待Codex；DONE由Codex验收；BLOCKED需说明原因。D01/D02/D03独立，D04依赖前三项实现及测试通过（可处于REVIEW）。

## D01 — 任务状态机

- 状态：READY
- 依赖：共享接口v1已冻结
- 修改：src/sim/mission.ts、tests/dsh/mission.test.mjs、报告与本项状态
- 实现：docs/CONTRACTS.md中两个任务函数
- 必测：首波到时只生成一次；波内部分击杀；重复/未知/旧波ID；间隔不提前刷怪；每次刷新符合上限；三波清完胜利；玩家/母舰失败；同帧失败优先；终态幂等；dt=0；非法dt/config；输入不被修改；两局从新状态开始不串数据。
- 验证：node --test tests/dsh/mission.test.mjs，然后npm run check
- 结果：尚未执行

## D02 — 伤害与武器状态

- 状态：READY
- 依赖：共享接口v1已冻结，可独立于D01执行
- 修改：src/sim/combat.ts、tests/dsh/combat.test.mjs、报告与本项状态
- 实现：伤害扣减、冷却、射击间隔、过热恢复
- 必测：伤害归零；零伤害；非法数值；首次射击；dt=0连发不绕过冷却；按住射击达到过热；未到阈值不解锁；冷却到阈值恢复；松开扳机冷却；输入对象不变；长期状态保持有限且热量范围合法。
- 验证：node --test tests/dsh/combat.test.mjs，然后npm run check
- 结果：尚未执行

## D03 — 设置存储

- 状态：READY
- 依赖：共享接口v1已冻结，可独立于D01/D02执行
- 修改：src/platform/settings.ts、tests/dsh/settings.test.mjs、报告与本项状态
- 实现：注入存储、带版本设置的读写、异常回退
- 必测：空值/坏JSON/null/数组/旧版本；缺字段；越界数值；字符串数值；错误quality；getItem/setItem抛错；完整保存加载往返；不污染默认值；忽略额外字段；检查写入的准确key与字段。
- 验证：node --test tests/dsh/settings.test.mjs，然后npm run check
- 结果：尚未执行

## D04 — 有界确定性回归与移交

- 状态：TODO（D01—D03测试通过后可自动改为READY，无需再问用户）
- 修改：tests/dsh/regression.test.mjs、已有DSH模块中的已复现缺陷、报告与本项状态
- 任务：写一个无图形、无实际延时的固定种子脚本，模拟任务、武器、伤亡和重开。
- 通过：同种子同输入得到相同结果；最多4个activeEnemyIds；同一波只生成一次；生命值不负、热量有限；结束后无新波；100次重开不残留敌机ID/击杀；长序列不修改输入或共享默认值。
- 限制：总步数有界（建议<=100000）、无真实sleep、无网络；不得为延长运行而无限压力测试。测试完成记录时间和Node版本，不据此推断GPU帧率。
- 验证：node --test tests/dsh/regression.test.mjs，然后npm run check
- 结果：尚未执行

## 队列结束

将D01—D04提交REVIEW后更新DSH_REPORT.md，列出测试证据与Codex需要集成的文件。不自行领取C01模型工作、不引入新玩法。若Codex暂不可用，保留当前可复现成果，下一轮从报告恢复。
