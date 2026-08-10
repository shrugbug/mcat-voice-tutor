import { describe, expect, test } from 'vitest';
import { shouldReconnect, getReconnectDelay, MAX_RECONNECT_ATTEMPTS, RECONNECT_BACKOFF_MS } from '../lib/realtime-client';

/**
 * Pure-logic tests for WS-B seamless reconnect (see docs/superpowers/specs/2026-08-10-jarvis-briefs.md
 * WS-B item 4: "extract reconnect decision (shouldReconnect(state, userInitiated, attempt)) and
 * backoff schedule as pure functions with tests. No WebRTC mocking."
 *
 * Trigger states per WS-B item 2: RTCPeerConnection connectionstate 'disconnected'/'failed'/'closed',
 * OR data channel close (represented as the synthetic 'datachannel-closed' state) -- the latter is
 * how the 60-minute server session cap manifests (data channel closes without necessarily flipping
 * the peer connection state first).
 */

describe('shouldReconnect', () => {
  test('reconnects on pc connectionstate "disconnected" when not user-initiated and under attempt cap', () => {
    expect(shouldReconnect('disconnected', false, 0)).toBe(true);
  });

  test('reconnects on pc connectionstate "failed"', () => {
    expect(shouldReconnect('failed', false, 0)).toBe(true);
  });

  test('reconnects on pc connectionstate "closed"', () => {
    expect(shouldReconnect('closed', false, 0)).toBe(true);
  });

  test('reconnects on data channel close (60-min server cap)', () => {
    expect(shouldReconnect('datachannel-closed', false, 0)).toBe(true);
  });

  test('does NOT reconnect when the user clicked Disconnect (userInitiated = true)', () => {
    expect(shouldReconnect('disconnected', true, 0)).toBe(false);
    expect(shouldReconnect('failed', true, 0)).toBe(false);
    expect(shouldReconnect('closed', true, 0)).toBe(false);
    expect(shouldReconnect('datachannel-closed', true, 0)).toBe(false);
  });

  test('does NOT reconnect on benign states like "connected", "connecting", "new"', () => {
    expect(shouldReconnect('connected', false, 0)).toBe(false);
    expect(shouldReconnect('connecting', false, 0)).toBe(false);
    expect(shouldReconnect('new', false, 0)).toBe(false);
  });

  test('stops reconnecting once the attempt count reaches the max (3)', () => {
    expect(shouldReconnect('disconnected', false, MAX_RECONNECT_ATTEMPTS - 1)).toBe(true);
    expect(shouldReconnect('disconnected', false, MAX_RECONNECT_ATTEMPTS)).toBe(false);
    expect(shouldReconnect('disconnected', false, MAX_RECONNECT_ATTEMPTS + 1)).toBe(false);
  });
});

describe('getReconnectDelay (backoff schedule: 1s / 5s / 15s)', () => {
  test('first attempt waits 1s', () => {
    expect(getReconnectDelay(1)).toBe(1000);
  });

  test('second attempt waits 5s', () => {
    expect(getReconnectDelay(2)).toBe(5000);
  });

  test('third attempt waits 15s', () => {
    expect(getReconnectDelay(3)).toBe(15000);
  });

  test('matches the exported RECONNECT_BACKOFF_MS schedule', () => {
    expect(RECONNECT_BACKOFF_MS).toEqual([1000, 5000, 15000]);
    expect(MAX_RECONNECT_ATTEMPTS).toBe(3);
  });

  test('throws for an out-of-range attempt number', () => {
    expect(() => getReconnectDelay(0)).toThrow(/attempt/i);
    expect(() => getReconnectDelay(4)).toThrow(/attempt/i);
  });
});
