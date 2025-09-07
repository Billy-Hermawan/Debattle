// db.ts
import { LiveRoom, AudioTurn, Interruption } from './core/types';

const ROOMS = new Map<string, LiveRoom>();
const RESULTS = new Map<string, any>();

export function getRoomById(id: string) { return ROOMS.get(id); }
export function saveRoom(room: LiveRoom) { ROOMS.set(room.cfg.debateId, room); }
export function forEachRoom(fn: (room: LiveRoom) => void) { ROOMS.forEach(fn); }

export async function saveAudioTurn(id: string, t: AudioTurn) {
  const r = ROOMS.get(id)!; r.audioTurns.push(t);
}
export async function attachInterruptionAsk(id: string, ev: Interruption) {
  const r = ROOMS.get(id)!; r.interruptions.push(ev);
}
export async function persistResult(id: string, result: any) { RESULTS.set(id, result); }
export async function loadResult(id: string) { return RESULTS.get(id); }
