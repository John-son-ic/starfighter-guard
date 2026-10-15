# Codex程序化建模源码

此目录已有venator.ts、eta2.ts、arc170.ts、vulture.ts；从index.ts的MODEL_CATALOG读取工厂与元数据。

工厂约定：createXxxModel(): THREE.Group，模型包围盒原点居中、Y向上、机头-Z、单位米、根节点scale=1。返回纯视觉对象；不包含AI/伤害/游戏循环。各次工厂调用拥有独立资源，使用disposeModel(root)清理；若未来自行clone对象，需另外明确共享资源生命周期。

使用docs/MVP.md的四种轮廓要求。所有模型由Codex通过实际截图检查，不由DSH自行验收。

primitives.ts用挤压轮廓、楔形、低段数球/柱等生成几何，finalize按材质合并成6—7个网格批次，再统一居中并校准长度。无纹理、无骨骼。建模时只统一校准长度，不宣称所有尺寸精确符合正史。

执行npm run models:export可更新public/models下的GLB。运行时可选工厂直接生成或GLTFLoader加载GLB，不要同时实例化两份。C02会另做简化碰撞形状，不应用完整视觉网格逐三角计算所有AI避障。
