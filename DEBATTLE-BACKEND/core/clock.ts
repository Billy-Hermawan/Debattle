// core/clock.ts

import { LiveRoom } from './types';
import { tick } from './fsm';

export class Clock {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private room: LiveRoom,
    private intervalMs = 1000,
    private onAfterTick?: (room: LiveRoom) => void
  ) {}

  start() {
    this.stop();
    this.timer = setInterval(() => {
      tick(this.room);
      this.onAfterTick?.(this.room);
    }, this.intervalMs);
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
