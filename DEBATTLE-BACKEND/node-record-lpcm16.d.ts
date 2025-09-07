declare module 'node-record-lpcm16' {
  import { Readable } from 'stream';
  export type RecordProgram = 'rec' | 'sox' | 'arecord';
  export interface Options {
    sampleRate?: number | string;
    threshold?: number;
    verbose?: boolean;
    recordProgram?: RecordProgram;
    device?: string;
    endOnSilence?: boolean;
  }
  export function start(options?: Options): Readable;
  export function stop(): void;
  const _default: { start: typeof start; stop: typeof stop };
  export default _default;
}