class ReconnectManager {
  constructor({
    maxAttempts = 5,
    initialDelayMs = 30000,
    maxDelayMs = 120000,
  } = {}) {
    this.maxAttempts = maxAttempts;
    this.initialDelayMs = initialDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.attemptCount = 0;
    this.timer = null;
    this.scheduled = false;
    this.exhausted = false;
  }

  schedule() {
    if (this.exhausted) {
      return { scheduled: false, attempt: this.attemptCount, delayMs: 0, exhausted: true };
    }

    if (this.scheduled) {
      return { scheduled: false, attempt: this.attemptCount, delayMs: 0 };
    }

    if (this.attemptCount >= this.maxAttempts) {
      this.exhausted = true;
      return {
        scheduled: false,
        attempt: this.attemptCount,
        delayMs: 0,
        maxReached: true,
      };
    }

    this.attemptCount += 1;
    this.scheduled = true;
    const delayMs = Math.min(this.initialDelayMs * this.attemptCount, this.maxDelayMs);

    return {
      scheduled: true,
      attempt: this.attemptCount,
      delayMs,
    };
  }

  setTimer(callback, delayMs) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.scheduled = false;
      if (callback) {
        callback();
      }
    }, delayMs);

    return this.timer;
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.attemptCount = 0;
    this.scheduled = false;
    this.exhausted = false;
  }

  markExhausted() {
    this.exhausted = true;
  }

  getAttemptCount() {
    return this.attemptCount;
  }

  isScheduled() {
    return this.scheduled;
  }

  isExhausted() {
    return this.exhausted;
  }
}

module.exports = { ReconnectManager };
