'use strict';

/** Host liveness polling interval (ms) */
const HOST_POLL_MS = 2000;

function parseHostPid(raw) {
  const pid = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : 0;
}

function hostIsGone(hostPid, kill = (pid, signal) => process.kill(pid, signal)) {
  if (!(hostPid > 0)) return false;
  try {
    kill(hostPid, 0);
    return false;
  } catch (err) {
    return Boolean(err) && err.code === 'ESRCH';
  }
}

function isBrokenPipeError(err) {
  const code = err && err.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

module.exports = { HOST_POLL_MS, parseHostPid, hostIsGone, isBrokenPipeError };
