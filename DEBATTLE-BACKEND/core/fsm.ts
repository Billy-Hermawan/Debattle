// core/fsm.ts

// Server-only authority for timing, speaking rights, and interruptions.

import { LiveRoom, Phase } from './types';

export const PHASE_TIME = (r: LiveRoom): Record<Phase, number> => ({
  LOBBY: 0,
  TEAM_DISCUSS: r.cfg.discussSeconds,           // 240
  SPEECH_A: r.cfg.speechSeconds,                // 120
  SPEECH_B: r.cfg.speechSeconds,                // 120
  INTERRUPTION_ASK: r.cfg.interruptionAskSeconds, // 10 (pauses speaker clock)
  CONCLUSION_A: r.cfg.conclusionSeconds,        // 120
  CONCLUSION_B: r.cfg.conclusionSeconds,        // 120
  JUDGING: 0,
  COMPLETE: 0
});

export function startDebate(room: LiveRoom) {
  room.phase = 'TEAM_DISCUSS';
  room.remaining = PHASE_TIME(room)['TEAM_DISCUSS'];
  room.floor = 'A'; // A will begin the first speech after discuss
}

// Tick once per second
export function tick(room: LiveRoom) {
  if (room.phase === 'COMPLETE' || room.phase === 'JUDGING') return;
  if (room.remaining > 0) room.remaining -= 1;
  if (room.remaining <= 0) advance(room);
}

export function advance(room: LiveRoom) {
  const p = room.phase;
  if (p === 'TEAM_DISCUSS') return toSpeech(room, 'A');
  if (p === 'SPEECH_A') return toSpeech(room, 'B');
  if (p === 'SPEECH_B') {
    // If both teams have delivered 'teamSize' speeches, go to conclusions
    const aDone = room.activeSpeakerIdxA === room.teamSize - 1;
    const bDone = room.activeSpeakerIdxB === room.teamSize - 1;
    if (aDone && bDone) return toConclusion(room, 'A');
    return toSpeech(room, 'A');
  }
  if (p === 'CONCLUSION_A') return toConclusion(room, 'B');
  if (p === 'CONCLUSION_B') { room.phase = 'JUDGING'; room.remaining = 0; return; }
  if (p === 'INTERRUPTION_ASK') {
    // ASK ended naturally — return to the same speech phase and resume the speaker's clock
    const back = room.floor === 'A' ? 'SPEECH_A' : 'SPEECH_B';
    room.phase = back;
    // speaker’s remaining was paused (we did not decrement during ASK)
    return;
  }
}

function toSpeech(room: LiveRoom, team: 'A'|'B') {
  room.phase = team === 'A' ? 'SPEECH_A' : 'SPEECH_B';
  room.floor = team;
  room.remaining = PHASE_TIME(room)[room.phase];

  // rotate speaker index for that team (3v3) *on entry*
  if (team === 'A') {
    room.activeSpeakerIdxA = Math.min(room.activeSpeakerIdxA + 1, room.teamSize - 1);
  } else {
    room.activeSpeakerIdxB = Math.min(room.activeSpeakerIdxB + 1, room.teamSize - 1);
  }
}

function toConclusion(room: LiveRoom, team: 'A'|'B') {
  room.phase = team === 'A' ? 'CONCLUSION_A' : 'CONCLUSION_B';
  room.floor = team;
  room.remaining = PHASE_TIME(room)[room.phase];
}

// Can team T request interruption right now?
export function canInterrupt(room: LiveRoom, team: 'A'|'B') {
  const opponentHasFloor =
    (room.phase === 'SPEECH_A' && team === 'B') ||
    (room.phase === 'SPEECH_B' && team === 'A');
  const withinEarlyWindow = room.remaining > room.cfg.interruptionEarlyWindowRemaining; // e.g., >90s remaining
  const tokens = room.interruptionsLeft[team] > 0;
  const nonePending = !room.interruptionState;

  return opponentHasFloor && withinEarlyWindow && tokens && nonePending;
}

// Start the ASK phase: pause speaker’s timer, start 10s ASK for interrupter
export function startInterruptionAsk(room: LiveRoom, by: 'A'|'B') {
  room.interruptionsLeft[by] -= 1;                       // consume token
  room.interruptionState = { by, startedAt: Date.now() };

  // swap to ASK sub-phase (we DO NOT decrement the speech timer during ASK)
  room.phase = 'INTERRUPTION_ASK';
  room.remaining = PHASE_TIME(room)['INTERRUPTION_ASK'];
}

// End ASK early (e.g., interrupter finished before 10s)
export function endInterruptionAsk(room: LiveRoom) {
  // Return to the same SPEECH_* phase for the speaker; resume their timer
  room.phase = room.floor === 'A' ? 'SPEECH_A' : 'SPEECH_B';
  room.interruptionState = undefined;
}

// Mark a rejected interruption (no ASK; tiny penalty later in scoring)
export function rejectInterruption(room: LiveRoom) {
  const by = room.interruptionState?.by;
  if (!by) return;
  // Record “rejected” event (handled in scoring)
  room.interruptions.push({ by, accepted: false, askAudioPath: '' });
  room.interruptionState = undefined;
  // Phase stays SPEECH_* and the speaker’s clock keeps running
}
