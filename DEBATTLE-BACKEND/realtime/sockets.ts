// realtime/sockets.ts
import { Server } from 'socket.io';
import { LiveRoom} from '../core/types';
import { tick, canInterrupt, startInterruptionAsk, endInterruptionAsk, rejectInterruption, startDebate } from '../core/fsm';
import { getRoomById, forEachRoom } from '../db';

export function initSockets(io: Server) {

  setInterval(() => {
  forEachRoom((room: LiveRoom) => {
    if (room.phase !== 'COMPLETE' && room.phase !== 'JUDGING') {
      tick(room); // only tick in active phases
    }

    io.to(room.cfg.debateId).emit('room_state', publicRoom(room));

    if (room.phase === 'JUDGING') {
      io.to(room.cfg.debateId).emit('debate_complete');
    }
  });
}, 1000);


  io.on('connection', (socket) => {
    socket.on('join_room', ({ debateId }) => {
      const room = getRoomById(debateId);
      if (!room) return socket.emit('error', 'no such room');
      socket.join(debateId);
      io.to(debateId).emit('room_state', publicRoom(room));
    });

    socket.on('start_debate', ({ debateId }) => {
      const room = getRoomById(debateId);
      if (!room) return;
      startDebate(room);
      io.to(debateId).emit('room_state', publicRoom(room));
    });

    socket.on('request_interrupt', ({ debateId, team }) => {
      const room = getRoomById(debateId);
      if (!room) return;
      if (!canInterrupt(room, team)) return;
      startInterruptionAsk(room, team);
      io.to(debateId).emit('interruption_started', { by: team, seconds: room.cfg.interruptionAskSeconds });
    });

    socket.on('reject_interrupt', ({ debateId }) => {
      const room = getRoomById(debateId);
      if (!room) return;
      rejectInterruption(room);
      io.to(debateId).emit('interruption_rejected');
    });

    socket.on('end_interrupt', ({ debateId }) => {
      const room = getRoomById(debateId);
      if (!room) return;
      endInterruptionAsk(room);
      io.to(debateId).emit('interruption_ended');
    });
  });
}

function publicRoom(room: LiveRoom) {
  return {
    debateId: room.cfg.debateId,
    topic: room.cfg.topic,
    phase: room.phase,
    remaining: room.remaining,
    floor: room.floor,
    teamSize: room.teamSize,
    interruptionsLeft: room.interruptionsLeft,
  };
}
