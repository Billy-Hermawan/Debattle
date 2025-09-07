// core/submit.ts
import { LiveRoom, AudioTurn } from './types';
import { transcribeAudio } from './stt';

export async function submitSpeech(room: LiveRoom, args: {
  team: 'A'|'B';
  phase: 'SPEECH_A'|'SPEECH_B'|'CONCLUSION_A'|'CONCLUSION_B';
  input: string; // "text:..." or "path/to.wav"
  speakerId?: string;
}) {
  // Basic guard: only the team with the floor can speak in SPEECH_* / CONCLUSION_*
  const floorOk =
    (room.phase === args.phase) &&
    ((room.phase.endsWith('_A') && args.team === 'A') ||
     (room.phase.endsWith('_B') && args.team === 'B'));

  if (!floorOk) throw new Error(`Not your floor or wrong phase: ${room.phase}`);

  const { text, ms } = await transcribeAudio(args.input);
  const rec: AudioTurn = {
    phase: args.phase, team: args.team, speakerId: args.speakerId,
    audioPath: args.input, text, ms, ts: Date.now()
  };
  room.audioTurns.push(rec);
}

export async function submitInterruptionAsk(room: LiveRoom, args: {
  by: 'A'|'B';
  input: string; // "text:..." or file path
}) {
  if (room.phase !== 'INTERRUPTION_ASK') throw new Error('No interruption window open');
  if (room.interruptionState?.by !== args.by) throw new Error('Not your interruption');
  const { text, ms } = await transcribeAudio(args.input);
  room.interruptions.push({ by: args.by, accepted: true, askAudioPath: args.input, askText: text });
  // caller will end ASK (resume speech) after this completes
}
