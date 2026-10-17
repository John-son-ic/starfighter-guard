# C15 — 加速双引擎尾焰

2026-10-17：增加玩家Eta-2加速蓝色尾焰，三层渐隐喷焰、轻微周期扰动；根据world.boosting平滑增强/收回，死亡隐藏、重开清零。特效跟随插值后的机体位置与旋转，暂停dt=0时冻结。引擎安装点由模型原始包围盒转换到finalize后的坐标，并写入模型userData，避免缩放/居中导致脱节。

新增exhaust.ts，复用1几何体/3材质/6网格，不使用点光源或逐帧粒子创建。dispose显式释放，尾焰不加入机体碰撞模型。GLB更新安装点元数据，模型外观几何不变。

npm run models:export及npm run check通过，170通过/4符号链接权限跳过。node scripts/exhaust-qa.mjs通过：实际Shift按键触发强度>0.8、松开收回<0.01、重开归零、浏览器异常0。已查看artifacts/c15-exhaust/boost.png，双喷口尾焰位置正确；软件渲染截图不证明硬件帧率。dist已更新，无DSH新任务。
