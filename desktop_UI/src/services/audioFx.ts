export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export interface FxParams { hp: number; ls: number; hs: number; width: number; panDepth: number; panRate: number; wet: number }
export interface FxConfig extends FxParams { name?: string; eq: number[]; eqFreqs?: number[]; eqQs?: number[] }
export interface CustomFx { name: string; eq: number[]; eqFreqs: number[]; eqQs: number[]; params: FxParams }
export interface FxSettings { preset: string; eq: number[]; eqFreqs: number[]; eqQs: number[]; params: FxParams; customs: CustomFx[] }
export const DEFAULT_FX_PARAMS: FxParams = { hp: 20, ls: 0, hs: 0, width: 1, panDepth: 0, panRate: 0.08, wet: 0 };
export const FX_PRESETS: Record<string, FxConfig> = {
  off: { name: '关闭', hp: 20, ls: 0, hs: 0, eq: [0,0,0,0,0,0,0,0,0,0], width: 1, panDepth: 0, panRate: 0.08, wet: 0 },
  bass: { name: '超重低音', hp: 20, ls: 7, hs: 1, eq: [4.5,4,2.5,-1.5,0,0,0,0,1,1.5], width: 1, panDepth: 0, panRate: 0.08, wet: 0 },
  vocal: { name: '清澈人声', hp: 120, ls: -1, hs: 1.5, eq: [0,0,-1,-1.5,0,1.5,3,3,1.5,0.5], width: 1.1, panDepth: 0, panRate: 0.08, wet: 0 },
  surround: { name: '360度环绕', hp: 20, ls: 0, hs: 0, eq: [0,0,0,0,0,0,0,0,0,0], width: 2, panDepth: 0.28, panRate: 0.08, wet: 0.08 },
  d3: { name: '3D音效', hp: 20, ls: 0, hs: 2, eq: [0,0,0,0,0,0,0.5,1,1.5,2], width: 1.7, panDepth: 0.12, panRate: 0.05, wet: 0.12 },
  live: { name: 'HIFI现场', hp: 20, ls: 1, hs: 2, eq: [0,0.5,1,0,0.5,0.5,0,1,1.5,2], width: 1.3, panDepth: 0, panRate: 0.08, wet: 0.18 },
  edm: { name: '动感电音', hp: 30, ls: 5, hs: 3, eq: [3,2.5,2,0,0,0,0.5,1.5,3,4], width: 1.2, panDepth: 0, panRate: 0.08, wet: 0.05 },
  rock: { name: '摇滚音效', hp: 40, ls: 3, hs: 2, eq: [3,2.5,1.5,-1,-1.5,0,1.5,2.5,2,1.5], width: 1.15, panDepth: 0, panRate: 0.08, wet: 0.04 },
  vinyl: { name: '复古唱片', hp: 120, ls: 2, hs: -3, eq: [1,2,2,1.5,0.5,0,-0.5,-2,-4.5,-8], width: 1.08, panDepth: 0, panRate: 0.08, wet: 0.03 },
};
export const FX_PARAMETERS: { key: keyof FxParams; name: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'hp', name: '低频截止', min: 20, max: 400, step: 1, unit: 'Hz' },
  { key: 'ls', name: '低架增益', min: -12, max: 12, step: 0.5, unit: 'dB' },
  { key: 'hs', name: '高架增益', min: -12, max: 12, step: 0.5, unit: 'dB' },
  { key: 'width', name: '空间宽度', min: 1, max: 3, step: 0.05, unit: '×' },
  { key: 'panDepth', name: '声像深度', min: 0, max: 0.6, step: 0.01, unit: '' },
  { key: 'panRate', name: '声像速率', min: 0.02, max: 0.5, step: 0.01, unit: 'Hz' },
  { key: 'wet', name: '混响湿度', min: 0, max: 0.5, step: 0.01, unit: '' },
];

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function bands(values: unknown, fallback: number[], min: number, max: number): number[] {
  return fallback.map((value, index) => finite(Array.isArray(values) ? values[index] : undefined, value, min, max));
}
function parameters(value: Partial<FxParams> = {}): FxParams {
  return Object.fromEntries(FX_PARAMETERS.map(def => [def.key, finite(value[def.key], DEFAULT_FX_PARAMS[def.key], def.min, def.max)])) as unknown as FxParams;
}
export function normalizeFxSettings(saved?: Partial<FxSettings> | null): FxSettings {
  return {
    preset: typeof saved?.preset === 'string' ? saved.preset : 'off',
    eq: bands(saved?.eq, EQ_FREQUENCIES.map(() => 0), -12, 12),
    eqFreqs: bands(saved?.eqFreqs, EQ_FREQUENCIES, 20, 20000),
    eqQs: bands(saved?.eqQs, EQ_FREQUENCIES.map(() => 1.1), 0.1, 6),
    params: parameters(saved?.params || {}),
    customs: Array.isArray(saved?.customs) ? saved.customs.filter(custom => custom && Array.isArray(custom.eq)).map(custom => ({
      name: custom.name || '自定义方案', eq: bands(custom.eq, EQ_FREQUENCIES.map(() => 0), -12, 12),
      eqFreqs: bands(custom.eqFreqs, EQ_FREQUENCIES, 20, 20000), eqQs: bands(custom.eqQs, EQ_FREQUENCIES.map(() => 1.1), 0.1, 6),
      params: parameters(custom.params || {}),
    })) : [],
  };
}
export function resolveFxConfig(settings: FxSettings): FxConfig {
  if (settings.preset === 'custom') return { ...settings.params, name: '自定义', eq: settings.eq, eqFreqs: settings.eqFreqs, eqQs: settings.eqQs };
  if (settings.preset.startsWith('custom:')) {
    const custom = settings.customs[Number(settings.preset.slice(7))];
    if (custom) return { ...custom.params, name: custom.name, eq: custom.eq, eqFreqs: custom.eqFreqs, eqQs: custom.eqQs };
  }
  return FX_PRESETS[settings.preset] || FX_PRESETS.off;
}
export function configToCustom(config: FxConfig): Omit<CustomFx, 'name'> {
  return { eq: [...config.eq], eqFreqs: [...(config.eqFreqs || EQ_FREQUENCIES)], eqQs: [...(config.eqQs || EQ_FREQUENCIES.map(() => 1.1))],
    params: { hp: config.hp, ls: config.ls, hs: config.hs, width: config.width, panDepth: config.panDepth, panRate: config.panRate, wet: config.wet } };
}

/** Owns audio nodes independently of React component mounts. */
export class AudioEffects {
  private nodes: AudioNode[] = [];
  private hp: BiquadFilterNode;
  private eq: BiquadFilterNode[];
  private low: BiquadFilterNode;
  private high: BiquadFilterNode;
  private width: GainNode;
  private wet: GainNode;
  private lfo: OscillatorNode;
  private depth: GainNode;
  constructor(private context: AudioContext, source: AudioNode, destination: AudioNode) {
    const ctx = context;
    const own = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node; };
    this.hp = own(ctx.createBiquadFilter()); this.hp.type = 'highpass'; this.hp.Q.value = 0.7;
    this.eq = EQ_FREQUENCIES.map(frequency => {
      const node = own(ctx.createBiquadFilter()); node.type = 'peaking'; node.frequency.value = frequency; node.Q.value = 1.1; return node;
    });
    this.low = own(ctx.createBiquadFilter()); this.low.type = 'lowshelf'; this.low.frequency.value = 90;
    this.high = own(ctx.createBiquadFilter()); this.high.type = 'highshelf'; this.high.frequency.value = 12000;
    const splitter = own(ctx.createChannelSplitter(2));
    const merger = own(ctx.createChannelMerger(2));
    const left = own(ctx.createGain()); left.gain.value = 0.5;
    const right = own(ctx.createGain()); right.gain.value = 0.5;
    splitter.connect(left, 0); splitter.connect(right, 1);
    const mid = own(ctx.createGain()); left.connect(mid); right.connect(mid);
    mid.connect(merger, 0, 0); mid.connect(merger, 0, 1);
    const negative = own(ctx.createGain()); negative.gain.value = -1; right.connect(negative);
    const side = own(ctx.createGain()); left.connect(side); negative.connect(side);
    this.width = own(ctx.createGain()); side.connect(this.width); this.width.connect(merger, 0, 0);
    const inverse = own(ctx.createGain()); inverse.gain.value = -1; this.width.connect(inverse); inverse.connect(merger, 0, 1);
    const panner = own(ctx.createStereoPanner()); merger.connect(panner);
    this.lfo = own(ctx.createOscillator()); this.lfo.type = 'sine';
    this.depth = own(ctx.createGain()); this.lfo.connect(this.depth); this.depth.connect(panner.pan); this.lfo.start();
    const convolution = own(ctx.createConvolver());
    const length = Math.floor(ctx.sampleRate * 1.9);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
    }
    convolution.buffer = impulse;
    this.wet = own(ctx.createGain());
    // Upmix mono media to both speakers before splitting the stereo channels.
    const stereoInput = own(ctx.createGain()); stereoInput.channelCount = 2;
    stereoInput.channelCountMode = 'explicit'; stereoInput.channelInterpretation = 'speakers';
    source.connect(stereoInput); stereoInput.connect(this.hp);
    let previous: AudioNode = this.hp;
    for (const eq of this.eq) { previous.connect(eq); previous = eq; }
    previous.connect(this.low); this.low.connect(this.high); this.high.connect(splitter);
    panner.connect(destination); panner.connect(convolution); convolution.connect(this.wet); this.wet.connect(destination);
    this.apply(normalizeFxSettings());
  }
  apply(settings: FxSettings): void {
    const config = resolveFxConfig(settings);
    const set = (parameter: AudioParam, value: number) => parameter.setTargetAtTime(value, this.context.currentTime, 0.03);
    set(this.hp.frequency, config.hp); set(this.low.gain, config.ls); set(this.high.gain, config.hs);
    this.eq.forEach((node, index) => {
      set(node.gain, config.eq[index] || 0); set(node.frequency, config.eqFreqs?.[index] || EQ_FREQUENCIES[index]); set(node.Q, config.eqQs?.[index] || 1.1);
    });
    set(this.width.gain, config.width); set(this.wet.gain, config.wet); set(this.depth.gain, config.panDepth); set(this.lfo.frequency, config.panRate);
  }
  dispose(): void { this.lfo.stop(); this.nodes.forEach(node => node.disconnect()); }
}
