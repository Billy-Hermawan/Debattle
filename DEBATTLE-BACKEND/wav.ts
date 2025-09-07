// wav.d.ts
declare module 'wav' {
  import { Writable, Readable } from 'stream';

  export interface WavOptions {
    channels?: number;
    sampleRate?: number;
    bitDepth?: number;
  }

  export class Writer extends Writable {
    constructor(options?: WavOptions);
  }

  export class FileWriter extends Writer {
    constructor(filePath: string, options?: WavOptions);
  }

  export class Reader extends Readable {}
}
