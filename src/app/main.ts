import { MVP_CONFIG } from '../shared/config.ts';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing #app root');

const title = document.createElement('h1');
title.textContent = 'Starfighter Guard · 工程基线';
const status = document.createElement('p');
status.textContent = '协作仓库已准备。当前尚未实现游戏、3D模型和飞行。';
const scope = document.createElement('p');
scope.textContent = `首版：1名玩家、${MVP_CONFIG.friendlies}架友军、最多${MVP_CONFIG.maxActiveEnemies}架敌机。`;
app.append(title, status, scope);
