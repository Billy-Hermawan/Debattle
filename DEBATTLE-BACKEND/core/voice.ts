// core/voice.ts
import vosk from 'vosk';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import recordModule from 'node-record-lpcm16'; // CJS default export
// Some setups require: const recordModule = (recordModuleDefault as any).default ?? recordModuleDefault

type Callbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: Error) => void;
};

export type VoiceController = {
  stop: () => void;
};

const SAMPLE_RATE = 16000;

export function startVoiceCapture(modelPath: string, cb: Callbacks = {}): VoiceController {
  vosk.setLogLevel(0);
  const model = new vosk.Model(modelPath);
  const rec = new vosk.Recognizer({ model, sampleRate: SAMPLE_RATE });

  // IMPORTANT: node-record-lpcm16 API is `record(...)`, not `start(...)`
  const recording = (recordModule as any)
    .record({
      sampleRateHertz: SAMPLE_RATE,
      threshold: 0,
      verbose: false,
      recordProgram: 'sox', // 'sox' or 'rec' (try 'rec' if 'sox' not found)
      silence: '10.0',
    });

  const stream: ChildProcessWithoutNullStreams = recording.stream();

  stream.on('data', (chunk: Buffer) => {
    try {
      if (rec.acceptWaveform(chunk)) {
        const r = rec.result(); // { text: "final text ..." }
        if (r?.text && cb.onFinal) cb.onFinal(r.text);
      } else {
        const p = rec.partialResult(); // { partial: "partial ..." }
        if (p?.partial && cb.onPartial) cb.onPartial(p.partial);
      }
    } catch (e: any) {
      cb.onError?.(e);
    }
  });

  stream.on('error', (err) => cb.onError?.(err as any));
  stream.on('close', () => {
    try { rec.free(); } catch {}
    try { model.free(); } catch {}
  });

  return {
    stop: () => {
      try { recording.stop(); } catch {}
      try {
        const r = rec.finalResult();
        if (r?.text && cb.onFinal) cb.onFinal(r.text);
      } catch {}
      try { rec.free(); } catch {}
      try { model.free(); } catch {}
    },
  };
}
