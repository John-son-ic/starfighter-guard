# Codex程序化建模源码

此目录尚未有模型。下一任务C01将创建venator.ts、eta2.ts、arc170.ts、vulture.ts。

工厂约定：createXxxModel(): THREE.Group，模型原点居中、Y向上、机头-Z。返回纯视觉对象；不包含AI/伤害/游戏循环。共享几何和材质的所有权由场景资源管理器明确管理，销毁一个实例不得破坏其他实例。

使用docs/MVP.md的四种轮廓要求。所有模型由Codex通过实际截图检查，不由DSH自行验收。
