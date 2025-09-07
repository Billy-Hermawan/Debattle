// core/types

// Core Types (Debate, Teams, Phases)

export type TeamSize = 1 | 3;

export type Phase =
  // Lobby
  | 'LOBBY'
  // Team discuss (private voice channel & discussion board within each team)
  | 'TEAM_DISCUSS'
  // Speech rounds
  | 'SPEECH_A' | 'SPEECH_B'
  // Optional interruption
  | 'INTERRUPTION_ASK'   // interrupter has N seconds to ask
  // Conclusion
  | 'CONCLUSION_A' | 'CONCLUSION_B'
  // AI Judging + complete
  | 'JUDGING' | 'COMPLETE';

export type DebateConfig = {
  debateId: string;
  topic: string;
  teamSize: TeamSize;         // 1 or 3
  discussSeconds: number;     // e.g., 240 (4 min)
  speechSeconds: number;      // e.g., 120 (2 min)
  conclusionSeconds: number;  // e.g., 120 (2 min)
  interruptionAskSeconds: number;     // e.g., 10
  interruptionEarlyWindowRemaining: number; // 30 (interruptions allowed only while remaining > 30)
  maxInterruptionsPerTeam: number;    // e.g., 3
};

export type Player = { id: string; name: string; team: 'A' | 'B'; order: 1|2|3 };

export type AudioTurn = {
  // Audio uploaded by client (no text typed). Server performs STT.
  phase: Phase;        // SPEECH_A/SPEECH_B/CONCLUSION_*
  team: 'A'|'B';
  speakerId?: string;
  audioPath: string;   // where we saved the blob
  text?: string;       // server STT result
  ms: number;          // duration
  ts: number;          // timestamp
};

export type Interruption = {
  by: 'A'|'B';         // who asked
  askAudioPath: string;
  askText?: string;    // STT result
  accepted: boolean;   // false => small civility penalty on interrupter
  // Response is part of the main speaker’s speech (no separate phase)
};


export type LiveRoom = {
  cfg: DebateConfig;
  phase: Phase;
  remaining: number;                   // seconds left in current phase
  floor: 'A'|'B';                      // who currently has the floor
  teamSize: TeamSize;

  // speaker indexes (0..teamSize-1)
  activeSpeakerIdxA: number;
  activeSpeakerIdxB: number;

  interruptionsLeft: { A: number; B: number };

  // When an interruption is pending / in ASK
  interruptionState?: { by: 'A'|'B'; startedAt: number };

  // Storage
  players: Player[];
  audioTurns: AudioTurn[];
  interruptions: Interruption[];
};