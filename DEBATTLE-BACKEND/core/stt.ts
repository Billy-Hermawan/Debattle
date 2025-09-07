// core/stt.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const PY = process.env.PYTHON_BIN || 'python3';
const STT_SCRIPT = process.env.STT_PY || path.resolve(__dirname, '../..', 'python', 'stt_cli.py');

export async function transcribeAudio(input: string): Promise<{ text: string; ms: number }> {
  // If you still want the "text:..." shortcut for tests, keep this:
  if (input.startsWith('text:')) {
    const text = input.slice('text:'.length).trim();
    const ms = Math.min(120000, Math.max(1000, text.split(/\s+/).length * 350));
    return { text, ms };
  }

  const { stdout } = await execFileAsync(PY, [STT_SCRIPT, '--in', input], { timeout: 60_000 });
  let out: any;
  try { out = JSON.parse(stdout); } catch {
    throw new Error('STT returned non-JSON output');
  }
  if (out.error) throw new Error(`STT failed: ${out.error}`);
  return { text: out.text || '', ms: Number(out.ms) || 0 };
}
