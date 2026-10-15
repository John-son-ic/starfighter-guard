import type { Group } from 'three';
import type { ModelId } from '../../shared/types.ts';
import { createVenatorModel } from './venator.ts';
import { createEta2Model } from './eta2.ts';
import { createArc170Model } from './arc170.ts';
import { createVultureModel } from './vulture.ts';

export const MODEL_CATALOG: Record<ModelId, { name: string; english: string; role: string; length: number; factory: () => Group; features: readonly string[] }> = {
  venator: { name: '狩猎者级', english: 'VENATOR-CLASS', role: '共和国主力舰 / 作战母舰', length: 1155, factory: createVenatorModel, features: ['楔形舰体', '双舰桥', '背部机库门', '引擎阵列'] },
  eta2: { name: '绝地截击机', english: 'ETA-2 ACTIS', role: '玩家座机 / 高机动截击', length: 5.47, factory: createEta2Model, features: ['分叉前部', '中央座舱', '散热翼', '黄色涂装'] },
  arc170: { name: 'ARC-170', english: 'AGGRESSIVE RECONNAISSANCE', role: '克隆人航空队 / 友军支援', length: 12.71, factory: createArc170Model, features: ['六翼轮廓', '三座座舱', '双侧引擎', '翼尖炮'] },
  vulture: { name: '秃鹫机器人战机', english: 'VULTURE DROID', role: '分离势力 / 敌方战斗机', length: 6.96, factory: createVultureModel, features: ['双侧爪翼', '机器人机身', '红色光学传感器', '飞行形态'] },
};
