//core/factory.ts

import { LiveRoom } from './types';

export function makeRoom(opts: {
  debateId: string;
  topic: string;
  teamSize: 1|3;
}): LiveRoom {
  return {
    cfg: {
      debateId: opts.debateId,
      topic: opts.topic,
      teamSize: opts.teamSize,
      discussSeconds: 240,
      speechSeconds: 120,
      conclusionSeconds: 120,
      interruptionAskSeconds: 10,
      interruptionEarlyWindowRemaining: 30,
      maxInterruptionsPerTeam: 3,
    },
    phase: 'LOBBY',
    remaining: 0,
    floor: 'A',
    teamSize: opts.teamSize,

    // will become 0 on first speech for that team
    activeSpeakerIdxA: -1,
    activeSpeakerIdxB: -1,

    interruptionsLeft: { A: 3, B: 3 },
    interruptionState: undefined,

    players: [],
    audioTurns: [],
    interruptions: [],
  };
}
