/** Small synthesized cues; no external audio or autoplay. Created only after launch click. */
export class FlightAudio {
  private context: AudioContext | null = null;
  volume = 0.6;
  start() {
    try { this.context ??= new AudioContext(); void this.context.resume(); } catch { /* Silent play remains usable. */ }
  }
  cue(kind: 'shot' | 'impact' | 'explosion' | 'command' | 'carrier-shot' | 'warning') {
    const context = this.context;
    if (!context || context.state !== 'running' || this.volume <= 0) return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    const duration = kind === 'explosion' ? 0.28 : kind === 'carrier-shot' ? 0.18 : kind === 'shot' ? 0.065 : 0.12;
    oscillator.type = kind === 'command' || kind === 'warning' ? 'sine' : 'sawtooth';
    oscillator.frequency.setValueAtTime(kind === 'warning' ? 880 : kind === 'shot' ? 720 : kind === 'explosion' ? 95 : kind === 'carrier-shot' ? 150 : 280, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'shot' ? 180 : 45, context.currentTime + duration);
    gain.gain.setValueAtTime(this.volume * (kind === 'shot' ? 0.025 : 0.05), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  dispose() { void this.context?.close(); }
}
