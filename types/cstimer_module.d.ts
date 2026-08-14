declare module 'cstimer_module' {
  interface CstimerModule {
    getScramble(type: string, length?: number): string;
    getScrambleTypes(): string[];
    setSeed(seed: string): void;
    setGlobal(key: string, value: unknown): void;
    getImage(scramble: string, type?: string): string;
  }
  const cstimer: CstimerModule;
  export default cstimer;
}
