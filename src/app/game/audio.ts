export type AudioCue = 'shot' | 'impact' | 'explosion' | 'command' | 'carrier-shot' | 'warning' | 'torpedo-launch' | 'torpedo-hit' | 'kill' | 'shield-hit' | 'shield-bounce';
interface Tone { wave: OscillatorType; from: number; to: number; duration: number; gain: number; delay?: number }
const tones: Record<AudioCue, readonly Tone[]> = {
  shot:[{wave:'sawtooth',from:720,to:180,duration:.065,gain:.025}],
  impact:[{wave:'sawtooth',from:280,to:45,duration:.12,gain:.05}],
  explosion:[{wave:'sawtooth',from:95,to:35,duration:.28,gain:.05}],
  command:[{wave:'sine',from:280,to:90,duration:.12,gain:.05}],
  'carrier-shot':[{wave:'sawtooth',from:150,to:45,duration:.18,gain:.05}],
  warning:[{wave:'sine',from:880,to:220,duration:.12,gain:.05}],
  'torpedo-launch':[{wave:'sawtooth',from:360,to:65,duration:.38,gain:.045},{wave:'triangle',from:700,to:140,duration:.2,gain:.035}],
  'torpedo-hit':[{wave:'triangle',from:180,to:38,duration:.32,gain:.11},{wave:'sawtooth',from:85,to:30,duration:.2,gain:.04}],
  kill:[{wave:'sine',from:660,to:660,duration:.1,gain:.045},{wave:'sine',from:990,to:990,duration:.16,gain:.045,delay:.09}],
  'shield-hit':[{wave:'sine',from:1600,to:500,duration:.14,gain:.035}],
  'shield-bounce':[{wave:'triangle',from:110,to:65,duration:.24,gain:.08},{wave:'sine',from:520,to:180,duration:.18,gain:.035}],
};

/** Shared by live audio and OfflineAudioContext QA; no downloaded audio assets. */
export function synthesizeCue(context: BaseAudioContext, kind: AudioCue, volume: number, ended: () => void = () => {}) {
  if(volume<=0)return 0;
  for(const tone of tones[kind]) {
    const oscillator=context.createOscillator(),gain=context.createGain();
    const start=context.currentTime+(tone.delay??0),end=start+tone.duration;
    oscillator.type=tone.wave;oscillator.frequency.setValueAtTime(tone.from,start);
    oscillator.frequency.exponentialRampToValueAtTime(tone.to,end);
    gain.gain.setValueAtTime(0,context.currentTime);gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime(volume*tone.gain,start+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,end);
    oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(end);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();ended();};
  }
  return tones[kind].length;
}

/** Small synthesized cues, created only after a launch/retry gesture. */
export class FlightAudio {
  private context: AudioContext | null = null;
  private nextCue = new Map<AudioCue,number>();
  private voices=0;
  volume = .6;
  start() {try {this.context??=new AudioContext();void this.context.resume();} catch { /* Silent play remains usable. */ }}
  cue(kind: AudioCue) {
    const context=this.context;
    if(!context||context.state!=='running'||this.volume<=0||this.voices+tones[kind].length>24||context.currentTime<(this.nextCue.get(kind)??0))return;
    this.nextCue.set(kind,context.currentTime+(kind==='shield-hit'?.08:kind==='explosion'?.08:.04));
    this.voices+=synthesizeCue(context,kind,this.volume,()=>this.voices--);
  }
  dispose() {void this.context?.close();}
}
