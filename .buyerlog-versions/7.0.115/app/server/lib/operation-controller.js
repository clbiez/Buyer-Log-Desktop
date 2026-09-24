'use strict';

const STATES = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  WAITING_FOR_USER: 'WAITING_FOR_USER',
  NAVIGATING: 'NAVIGATING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const DEFAULT_TIMEOUTS = Object.freeze({
  userApprovalTimeout: 10 * 60 * 1000,
  navigationTimeout: 45 * 1000,
  networkTimeout: 20 * 1000,
  operationTimeout: 120 * 1000,
});

const TIMEOUT_CODES = Object.freeze({
  userApprovalTimeout: 'USER_APPROVAL_TIMEOUT',
  navigationTimeout: 'NAVIGATION_TIMEOUT',
  networkTimeout: 'NETWORK_TIMEOUT',
  operationTimeout: 'OPERATION_TIMEOUT',
});

function timeoutError(timeoutType, timeoutMs) {
  const messages = {
    userApprovalTimeout: 'Tarayıcı onayı süresi doldu.',
    navigationTimeout: 'Sayfa navigasyonu zaman aşımına uğradı.',
    networkTimeout: 'Ağ isteği zaman aşımına uğradı.',
    operationTimeout: 'İşlem zaman aşımına uğradı.',
  };
  const message = messages[timeoutType] || 'İşlem zaman aşımına uğradı.';
  return Object.assign(new Error(message), {
    code: TIMEOUT_CODES[timeoutType] || 'OPERATION_TIMEOUT',
    timeoutType,
    timeoutMs,
    statusCode: 504,
  });
}

function cancelledError(reason = 'user_cancelled') {
  return Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi.'), {
    code: reason === 'user_cancelled' ? 'USER_CANCELLED' : 'OPERATION_CANCELLED',
    reason,
  });
}

function positiveTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

class OperationController {
  constructor(options = {}) {
    this.timeouts = Object.fromEntries(Object.entries(DEFAULT_TIMEOUTS).map(([key, fallback]) => [
      key,
      positiveTimeout(options[key] ?? options[`${key}Ms`], fallback),
    ]));
    this.state = STATES.IDLE;
    this.startedAt = null;
    this.phaseStartedAt = null;
    this.approvalStartedAt = null;
    this.remainingOperationMs = this.timeouts.operationTimeout;
    this.pendingApproval = null;
    this.error = null;
    this._operationTimer = null;
    this._approvalTimer = null;
    this._onTimeout = typeof options.onTimeout === 'function' ? options.onTimeout : null;
    this._onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
    this.abortController = new AbortController();
  }

  start() {
    if (this.state !== STATES.IDLE) return this;
    this.startedAt = Date.now();
    this.phaseStartedAt = this.startedAt;
    this._setState(STATES.RUNNING);
    this._armOperationWatchdog();
    return this;
  }

  timeoutFor(timeoutType) {
    return this.timeouts[timeoutType];
  }

  enterWaitingForUser(details = {}) {
    if (this.state === STATES.IDLE) this.start();
    if ([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(this.state)) return this;
    this._pauseOperationWatchdog();
    this._clearApprovalTimer();
    this.approvalStartedAt = Date.now();
    this.pendingApproval = { ...details };
    this._setState(STATES.WAITING_FOR_USER);
    this._approvalTimer = setTimeout(() => this._timeout('userApprovalTimeout'), this.timeouts.userApprovalTimeout);
    this._approvalTimer.unref?.();
    this._emit();
    return this;
  }

  resumeAfterUserApproval() {
    if (this.state !== STATES.WAITING_FOR_USER) return false;
    this._clearApprovalTimer();
    this.pendingApproval = null;
    this.approvalStartedAt = null;
    this.phaseStartedAt = Date.now();
    this._setState(STATES.NAVIGATING);
    this._armOperationWatchdog();
    return true;
  }

  complete(result = null) {
    if ([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(this.state)) return this;
    this._clearTimers();
    this.result = result;
    this._setState(STATES.COMPLETED);
    return this;
  }

  fail(error) {
    if ([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(this.state)) return this;
    this._clearTimers();
    this.error = error instanceof Error ? error : new Error(String(error || 'Operation failed'));
    this._setState(STATES.FAILED);
    if (!this.abortController.signal.aborted) this.abortController.abort(this.error);
    return this;
  }

  cancel(reason = 'user_cancelled') {
    if ([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(this.state)) return this;
    this._clearTimers();
    this.error = cancelledError(reason);
    this._setState(STATES.CANCELLED);
    if (!this.abortController.signal.aborted) this.abortController.abort(this.error);
    return this;
  }

  snapshot() {
    return {
      state: this.state,
      startedAt: this.startedAt,
      approvalStartedAt: this.approvalStartedAt,
      pendingApproval: this.pendingApproval,
      error: this.error ? { message: this.error.message, code: this.error.code, reason: this.error.reason, timeoutType: this.error.timeoutType, timeoutMs: this.error.timeoutMs } : null,
      timeouts: { ...this.timeouts },
      operationRemainingMs: Math.max(0, Math.round(this._currentRemainingOperationMs())),
    };
  }

  dispose() {
    this._clearTimers();
    return this;
  }

  _currentRemainingOperationMs() {
    if (this.state === STATES.WAITING_FOR_USER || !this.phaseStartedAt) return this.remainingOperationMs;
    return Math.max(0, this.remainingOperationMs - (Date.now() - this.phaseStartedAt));
  }

  _pauseOperationWatchdog() {
    this.remainingOperationMs = this._currentRemainingOperationMs();
    if (this._operationTimer) clearTimeout(this._operationTimer);
    this._operationTimer = null;
    this.phaseStartedAt = null;
  }

  _armOperationWatchdog() {
    if (this.state === STATES.WAITING_FOR_USER || this.remainingOperationMs <= 0) {
      if (this.remainingOperationMs <= 0) this._timeout('operationTimeout');
      return;
    }
    if (this._operationTimer) clearTimeout(this._operationTimer);
    this.phaseStartedAt = Date.now();
    this._operationTimer = setTimeout(() => this._timeout('operationTimeout'), this.remainingOperationMs);
    this._operationTimer.unref?.();
  }

  _timeout(timeoutType) {
    if ([STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED].includes(this.state)) return;
    const error = timeoutError(timeoutType, this.timeouts[timeoutType]);
    this.error = error;
    this._clearTimers();
    this._setState(STATES.FAILED);
    if (!this.abortController.signal.aborted) this.abortController.abort(error);
    try { this._onTimeout?.(error, this.snapshot()); } catch (_) {}
  }

  _clearApprovalTimer() {
    if (this._approvalTimer) clearTimeout(this._approvalTimer);
    this._approvalTimer = null;
  }

  _clearTimers() {
    if (this._operationTimer) clearTimeout(this._operationTimer);
    this._operationTimer = null;
    this._clearApprovalTimer();
  }

  _setState(state) {
    this.state = state;
    this._emit();
  }

  _emit() {
    try { this._onStateChange?.(this.snapshot()); } catch (_) {}
  }
}

module.exports = { STATES, DEFAULT_TIMEOUTS, TIMEOUT_CODES, OperationController, timeoutError, cancelledError };
