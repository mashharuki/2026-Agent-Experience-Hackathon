/** Original synthesized ambience; no downloaded sound assets. Explicit opt-in only. */
export class RaceAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  async enable() {
    if (!this.context) {
      const context = new AudioContext();
      this.context = context;
      const buffer = context.createBuffer(
        1,
        context.sampleRate * 2,
        context.sampleRate,
      );
      const data = buffer.getChannelData(0);
      let n = 32;
      for (let i = 0; i < data.length; i++) {
        n = (n * 1664525 + 1013904223) >>> 0;
        data[i] = (n / 0xffffffff - 0.5) * 0.4;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 600;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(context.destination);
      source.start();
      this.gain = gain;
      this.filter = filter;
      this.source = source;
    }
    await this.context.resume();
  }
  update(speed: number, wind: number, running: boolean) {
    const c = this.context;
    if (!c || !this.gain || !this.filter) return;
    this.gain.gain.setTargetAtTime(
      running ? Math.min(0.5, 0.07 + speed * 0.035 + wind * 0.01) : 0,
      c.currentTime,
      0.3,
    );
    this.filter.frequency.setTargetAtTime(
      350 + speed * 140,
      c.currentTime,
      0.3,
    );
  }
  horn() {
    const c = this.context;
    if (c?.state !== "running") return;
    const oscillator = c.createOscillator(),
      gain = c.createGain();
    oscillator.frequency.value = 220;
    oscillator.type = "triangle";
    gain.gain.setValueAtTime(0.045, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
    oscillator.connect(gain).connect(c.destination);
    oscillator.start();
    oscillator.stop(c.currentTime + 0.65);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  mute() {
    this.update(0, 0, false);
  }
  dispose() {
    this.source?.stop();
    void this.context?.close();
    this.context = null;
  }
}
