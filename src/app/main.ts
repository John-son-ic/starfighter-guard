import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing #app root');

try {
  if (new URLSearchParams(location.search).get('mode') === 'models') {
    const { startModelViewer } = await import('../visual/viewer.ts');
    startModelViewer(app);
  } else {
    const { startFlight } = await import('./game/start.ts');
    startFlight(app);
  }
} catch (error) {
  app.replaceChildren();
  const message = document.createElement('p');
  message.className = 'error-message';
  message.textContent = `场景无法启动：${error instanceof Error ? error.message : String(error)}。请确认浏览器启用了硬件加速与 WebGL 2。`;
  app.append(message);
}
