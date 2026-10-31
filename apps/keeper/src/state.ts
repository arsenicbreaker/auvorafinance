export interface KeeperRuntimeSnapshot {
  startedAt: Date;
  pollRunning: boolean;
  lastPollStartedAt: Date | null;
  lastSuccessfulPollAt: Date | null;
  lastErrorCode: string | null;
}

export class KeeperRuntimeState {
  private readonly startedAt = new Date();
  private pollRunning = false;
  private lastPollStartedAt: Date | null = null;
  private lastSuccessfulPollAt: Date | null = null;
  private lastErrorCode: string | null = null;

  startPoll(at: Date): void {
    this.pollRunning = true;
    this.lastPollStartedAt = at;
  }

  completePoll(at: Date): void {
    this.pollRunning = false;
    this.lastSuccessfulPollAt = at;
    this.lastErrorCode = null;
  }

  failPoll(errorCode: string): void {
    this.pollRunning = false;
    this.lastErrorCode = errorCode;
  }

  snapshot(): KeeperRuntimeSnapshot {
    return {
      startedAt: this.startedAt,
      pollRunning: this.pollRunning,
      lastPollStartedAt: this.lastPollStartedAt,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      lastErrorCode: this.lastErrorCode,
    };
  }
}
