// dev-test/terminal.ts
//  npx ts-node DEBATTLE-BACKEND\dev-test\terminal.ts
import readline from 'readline';
import { v4 as uuid } from 'uuid';
import { makeRoom } from '../core/factory';
import { Clock } from '../core/clock';
import path from 'path';
import { spawn } from 'child_process';
import fs from "fs";
import os from "os";
import {
  startDebate,
  advance,
  canInterrupt,
  startInterruptionAsk,
  endInterruptionAsk,
  tick as fsmTick,
} from '../core/fsm';
import { submitSpeech, submitInterruptionAsk } from '../core/submit';
import { heuristicJudge } from '../core/scoring';

const AREA_CHOICES = ['business', 'constitutional', 'criminal'] as const;
type Area = typeof AREA_CHOICES[number];

function mmss(total: number) {
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = Math.floor(total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Map our log to DeepSeek judge's DEFAULT_TRANSCRIPT-like format:
//   [mm:ss AFF-1] text ...
//   [mm:ss NEG-Reply] text ...
function buildJudgeTranscript(): string {
  // If no speeches captured, return a tiny placeholder to avoid empty file
  if (speechLog.length === 0) {
    return `[00:00 AFF-1] No speeches captured.\n`;
  }

  const numIdx: Record<"A" | "B", number> = { A: 0, B: 0 };
  const lines: string[] = [];

  for (const s of speechLog.sort((a, b) => a.tSec - b.tSec)) {
    const time = mmss(s.tSec);
    const side = s.team === "A" ? "AFF" : "NEG";

    // decide label: 1/2/3 or Reply based on phase
    let slot: string;
    if (/CONCLUSION/i.test(s.phase) || /REPLY/i.test(s.phase)) {
      slot = "Reply";
    } else {
      numIdx[s.team] = Math.min(3, numIdx[s.team] + 1);
      const n = Math.max(1, numIdx[s.team]);
      slot = `${n}`;
    }
    const tag = slot === "Reply" ? `${side}-Reply` : `${side}-${slot}`;

    // strip newlines to keep judge input tidy
    const clean = s.text.replace(/\s+/g, " ").trim();
    lines.push(`[${time} ${tag}] ${clean}`);
  }

  return lines.join("\n") + "\n";
}

function mapArea(input: string): Area | null {
  const t = (input || '').trim().toLowerCase();
  if (!t) return null;

  // direct numeric options
  if (t === '1') return 'business';
  if (t === '2') return 'constitutional';
  if (t === '3') return 'criminal';

  // easy aliases
  if (['b', 'bu', 'bus', 'business'].includes(t)) return 'business';
  if (['c', 'co', 'cons', 'const', 'constitution', 'constitutional'].includes(t)) return 'constitutional';
  if (['cr', 'cri', 'crim', 'criminal'].includes(t)) return 'criminal';

  // tolerant prefixes (handles typos like "constituitional")
  const norm = t.replace(/[^a-z]/g, '');
  if (norm.startsWith('bus')) return 'business';
  if (norm.startsWith('cons') || norm.startsWith('consti')) return 'constitutional';
  if (norm.startsWith('crim')) return 'criminal';

  return null;
}

async function askAreaOrSkip(): Promise<Area | null> {
  const pick = (await ask(
    'Generate a case? Enter 1=Business, 2=Constitutional, 3=Criminal, or press Enter to skip: '
  )).trim();
  return mapArea(pick); // null means "skip"
}

async function runPythonJudgeWithTranscript(transcriptText: string): Promise<number> {
  const tmpPath = path.join(os.tmpdir(), `debattle_transcript_${uuid()}.txt`);
  fs.writeFileSync(tmpPath, transcriptText, "utf8");

  const pythonCmd =
    process.platform === "win32" ? "python" : "python3";
  const JUDGE_PY = path.resolve(__dirname, "..", "api", "judge.py"); // adjust if your judge.py lives elsewhere

  return await new Promise<number>((resolve) => {
    const p = spawn(pythonCmd, [JUDGE_PY, "--transcript", tmpPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");

    p.stdout.on("data", (d) => process.stdout.write(d));                // print judge output directly
    p.stderr.on("data", (d) => process.stderr.write("[judge] " + d));   // surface errors

    p.on("close", (code) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      resolve(code ?? 1);
    });
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

// simple promise wrapper for readline.question
const ask = (q: string) =>
  new Promise<string>(res => rl.question(q, a => res(a)));

let DEFAULT_TOPIC = 'AI-generated evidence should be admissible';

// state
let auto = true;               // auto ON by default
let intervalMs = 1000;         // real seconds
let room = makeRoom({ debateId: uuid(), topic: DEFAULT_TOPIC, teamSize: 1 });
let clock = new Clock(room, intervalMs);
let judgeRan = false;          // ensures judge runs only once per debate

// phase-change tracking
let prevPhase = room.phase;
let watchTimer: NodeJS.Timeout | undefined;

function show() {
  console.log({
    phase: room.phase,
    remaining: Math.max(0, Math.round(room.remaining)),
    floor: room.floor,
    teamSize: room.teamSize,
    A_interrupts: room.interruptionsLeft.A,
    B_interrupts: room.interruptionsLeft.B,
  });
}

// Only print the state from here when tag === 'auto' to avoid duplicates
function logPhaseChange(tag: 'auto' | 'start' | 'advance' | 'fast-forward' | 'interrupt-ask' | 'interrupt-end') {
  console.log(`→ Phase changed: ${prevPhase} → ${room.phase} [${tag}]`);
  prevPhase = room.phase;
  if (tag === 'auto') show(); // auto ticks print the snapshot; manual callers will do their own show()
}

function startWatch() {
  stopWatch();
  watchTimer = setInterval(() => {
    if (room.phase !== prevPhase) {
      logPhaseChange('auto');
    }
  }, 200);
}
function stopWatch() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = undefined;
}

function startAuto() { if (auto) clock.start(); }
function stopAuto()  { clock.stop(); }

// fast-forward N debate seconds; log phase changes along the way (no duplicate show)
function fastForward(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const wasAuto = auto;
  stopAuto();
  const wasWatching = !!watchTimer;
  stopWatch();

  for (let i = 0; i < seconds; i++) {
    const before = room.phase;
    fsmTick(room);               // 1 debate second per call
    if (room.phase !== before) logPhaseChange('fast-forward');
  }

  if (wasWatching) startWatch();
  if (wasAuto) startAuto();
  show(); // single snapshot after the jump
}

type CaseGenOut = { motion: string; hypothetical: string };

type LoggedSpeech = { tSec: number; team: "A" | "B"; phase: string; text: string };

// tracking for transcript
let debateStartMs = 0;
const speechLog: LoggedSpeech[] = [];
const speechCount = { A: 0, B: 0 }; // to map 1st/2nd/3rd speeches per side

function runCaseGenInteractive(
  area: 'business' | 'constitutional' | 'criminal' = 'business'
): Promise<CaseGenOut | null> {
  // Your Python file is here per your screenshot:
  // DEBATTLE-BACKEND/api/case.py
  const CASE_GEN_PY = path.resolve(__dirname, '..', 'api', 'case.py');

  // Pick a Python command that works on your machine
  // If 'python' fails on Windows, try 'py'.
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  return new Promise((resolve) => {
    const p = spawn(pythonCmd, [CASE_GEN_PY], { stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '';
    let err = '';

    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));

    // Feed the area the Python script asks for (“Choose case type: …”)
    p.stdin.write(area + '\n');

    p.on('close', () => {
      if (err.trim()) console.error('[case-gen stderr]', err.trim());

      // Pull the “Suggested debate motion …” line
      const motionMatch = /Suggested\s+debate\s+motion[^:\n]*:\s*(.+)/i.exec(out);
      const motion = (motionMatch?.[1] || '')
        .trim()
        .replace(/^[-–—"'“”']+|[-–—"'“”']+$/g, '');

      // Grab the block the Python prints (best-effort)
      const startIdx = out.indexOf('HYPOTHETICAL');
      const endIdx = out.indexOf('Sources used for inspiration:');
      const hypothetical =
        startIdx >= 0 && endIdx > startIdx ? out.slice(startIdx, endIdx).trim() : out.trim();

      if (!motion) {
        // fallback if we couldn't parse a motion
        return resolve({ motion: DEFAULT_TOPIC, hypothetical });
      }
      resolve({ motion, hypothetical });
    });
  });
}

// ==== Text-only speech support ====
type SpeechPhase = 'SPEECH_A' | 'SPEECH_B' | 'CONCLUSION_A' | 'CONCLUSION_B';

// helper to run the judge (manual or automatic trigger)
async function runJudgeNow(trigger: 'manual' | 'conclusion_b' | 'auto' = 'auto') {
  if (judgeRan) return;
  judgeRan = true;

  // pause clocks so phases don’t keep moving while we judge
  stopAuto();

  try {
    const transcript = buildJudgeTranscript();
    console.log("\n===== SUBMITTED TRANSCRIPT =====\n" + transcript + "================================\n");
    const code = await runPythonJudgeWithTranscript(transcript);

    if (code !== 0) {
      console.log("\n(judge.py failed — falling back to heuristic judge)\n");
      const result = await heuristicJudge(room);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e: any) {
    console.log("\n(judge integration error — using heuristic judge)\n");
    const result = await heuristicJudge(room);
    console.log(JSON.stringify(result, null, 2));
  }
}

// ==== Bootstrap ====
async function bootstrap() {
  let generatedTopic: string | null = null;

  // --- Ask first, then (optionally) generate ---
  try {
    const chosenArea = await askAreaOrSkip();
    if (chosenArea) {
      const generated = await runCaseGenInteractive(chosenArea);
      if (generated) {
        console.log('\n===== AUTO-GENERATED CASE =====\n');
        console.log(generated.hypothetical);
        console.log('\n===== END CASE =====\n');
        console.log(`Suggested motion: ${generated.motion}\n`);
        generatedTopic = (generated.motion || '').trim() || null;
        if (generatedTopic) DEFAULT_TOPIC = generatedTopic;
      } else {
        console.log('(!) Proceeding without auto-generated case (generator failed).');
      }
    } else {
      console.log('(skip) No auto-generated case.');
    }
  } catch {
    console.log('(!) Skipping auto-generation due to error.');
  }

  // --- Your original flow, but skip "Topic" prompt if we already have one ---
  const sizeAns = (await ask('Team size (1 or 3)? [1]: ')).trim();
  const teamSize = sizeAns === '3' ? 3 : 1;

  const topic =
    generatedTopic ??
    (await (async () => {
      const topicAns = (await ask(`Topic [${DEFAULT_TOPIC}]: `)).trim();
      return topicAns || DEFAULT_TOPIC;
    })());

  room = makeRoom({ debateId: uuid(), topic, teamSize });
  clock = new Clock(room, intervalMs);
  judgeRan = false; // reset judge guard for this new room

  prevPhase = room.phase;
  startWatch();

  console.log(`Room ${room.cfg.debateId} created (teamSize=${teamSize}). Auto clock is ON.`);
  console.log(`Type 'start' to begin. Type 'help' for commands.`);
  rl.prompt();
}

rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(' ');
  try {
    if (cmd === 'help') {
      console.log(`Commands:
  show
  start                     # begins debate; auto clock runs (1s ticks)
  auto on|off               # toggle auto ticking
  tick N                    # fast-forward N debate seconds instantly
  speed MS                  # change auto tick interval (default 1000)
  advance                   # force next phase (debug)
  speak A|B PHASE text:...  # e.g., speak A SPEECH_A text:Issue...
  interrupt A|B
  ask A|B text:Question?
  judge
  reset                     # interactive re-create (asks team size & topic)
  quit`);
    } else if (cmd === 'show') {
      show();

    } else if (cmd === 'start') {
      const before = room.phase;
      startDebate(room);
      debateStartMs = Date.now();
      speechLog.length = 0;
      speechCount.A = 0; speechCount.B = 0;
      judgeRan = false; // new debate run → allow judge to fire

      if (room.phase !== before) logPhaseChange('start'); // prints arrow only; we'll show() below
      startAuto();
      show(); // single snapshot

    } else if (cmd === 'auto') {
      const mode = (rest[0] || '').toLowerCase();
      if (mode === 'on') {
        auto = true; startAuto(); console.log('Auto clock: ON');
      } else {
        auto = false; stopAuto(); console.log('Auto clock: OFF');
      }

    } else if (cmd === 'tick') {
      const raw = (rest[0] || '1').replace(/[()]/g, '');
      const n = Math.max(0, Number(raw) || 0);
      fastForward(n);

    } else if (cmd === 'speed') {
      intervalMs = Math.max(10, Number(rest[0] || 1000));
      stopAuto();
      clock = new Clock(room, intervalMs);
      if (auto) startAuto();
      console.log(`Tick interval set to ${intervalMs}ms`);

    } else if (cmd === 'advance') {
      const before = room.phase;
      advance(room);
      if (room.phase !== before) logPhaseChange('advance');
      show();

    } else if (cmd === 'speak') {

      const team = rest[0] as 'A'|'B';
      const phase = rest[1] as SpeechPhase;
      const input = rest.slice(2).join(' ');
      await submitSpeech(room, { team, phase: phase as any, input });
      console.log('OK: speech captured.');
      const nowSec = Math.max(0, Math.floor((Date.now() - debateStartMs) / 1000));
      speechLog.push({ tSec: nowSec, team, phase, text: input });

      // increment speech counters for non-reply phases
      if (phase.startsWith("SPEECH_")) {
        if (team === "A") speechCount.A = Math.min(3, speechCount.A + 1);
        if (team === "B") speechCount.B = Math.min(3, speechCount.B + 1);
      }

      // if B just delivered their conclusion, run judge immediately
      if (team === "B" && phase === "CONCLUSION_B") {
        await runJudgeNow('conclusion_b');
      }

    } else if (cmd === 'interrupt') {
      const by = rest[0] as 'A'|'B';
      if (!canInterrupt(room, by)) {
        console.log('Not allowed now.');
      } else {
        const before = room.phase;
        startInterruptionAsk(room, by);
        if (room.phase !== before) logPhaseChange('interrupt-ask'); // SPEECH_* -> INTERRUPTION_ASK
        console.log('Interruption started (ASK 10s).');
        show();
      }

    } else if (cmd === 'ask') {
      const by = rest[0] as 'A'|'B';
      const input = rest.slice(1).join(' ');
      await submitInterruptionAsk(room, { by, input });

      const before = room.phase;
      endInterruptionAsk(room);                  // INTERRUPTION_ASK -> SPEECH_*
      if (room.phase !== before) logPhaseChange('interrupt-end');

      console.log('ASK recorded. Resuming speech.');
      show();

    } else if (cmd === 'judge') {
      await runJudgeNow('manual');

    } else if (cmd === 'reset') {
      stopAuto();
      await bootstrap();

    } else if (cmd === 'quit') {
      rl.close(); process.exit(0);

    } else {
      console.log('Unknown command. Type "help".');
    }
  } catch (e: any) {
    console.error('ERR:', e.message);
  }
  rl.prompt();
});

// kick things off interactively
void bootstrap();
