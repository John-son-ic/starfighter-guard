# DSH行为测试

使用Node内置node:test与node:assert/strict；文件名为*.test.mjs，可直接import ../../src/sim/mission.ts等TypeScript文件。Node 24会擦除类型；类型正确性另由npm run typecheck验证。

必须测试可观察行为和边界，不能仅把实现内容复写成断言。测试会由scripts/test.mjs递归发现。
