# 架构与边界

TypeScript + Three.js + Vite；Node 24；测试采用Node内置test runner，直接运行可擦除类型的TS。不引入测试框架、React、物理引擎或游戏后端。

```text
src/shared/types.ts          冻结接口；不依赖其他模块
src/shared/config.ts         首版数据；Codex维护
src/sim/mission.ts           DSH D01：波次/结果纯状态机
src/sim/combat.ts            DSH D02：生命值/武器热量纯函数
src/platform/settings.ts    DSH D03：注入存储的设置适配
src/visual/models/          Codex C01：程序化模型
src/visual/                 Codex：材质、效果、相机
src/app/                    Codex C02/C03：游戏循环、飞行AI、碰撞、集成
tests/dsh/                  DSH行为测试
```

渲染只能消费/更新约定的数据，纯逻辑不得创建Mesh。世界中谁击中了谁由Codex的三维碰撞系统判断，再交给DSH的伤害函数。AI的视觉路径、飞行转向和舰体避障属于Codex范围；DSH不凭看不到的场景调机动参数。

模拟固定步长1/60秒；实际画面requestAnimationFrame插值。暂停/失焦期间不推进模拟、不补算离线时间。内部每步dt不超过0.1秒，追帧最多5步。这里是后续集成要求，当前尚未实现主循环。

数据流：输入 → 运动/AI → 碰撞 → 生命值/武器状态 → 任务状态机 → 消费一次性任务事件 → 渲染/HUD。每个step仅调用一次mission推进函数；任务返回的events仅有效于当前步。

主循环在消费spawn-wave后立即生成对应ID的敌机。敌机死亡时ID加入该步destroyedEnemyIds；清理实体后继续推进。请严格遵循docs/CONTRACTS.md，不以“世界中此刻没有敌机”推断胜利。

基线入口目前只有说明文字，不假装是游戏。模型与可玩场景是下一阶段Codex的明确任务；DSH可以在完全没有3D场景的条件下完成D01—D04。
