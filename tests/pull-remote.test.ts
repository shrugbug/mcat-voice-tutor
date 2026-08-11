import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const PULL_SCRIPT = resolve('scripts/pull-remote.sh');

function executable(path: string, contents: string): void {
  writeFileSync(path, contents, 'utf8');
  chmodSync(path, 0o755);
}

describe('pull-remote cleanup', () => {
  test('removes a non-guessable remote snapshot when rsync fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcat-pull-test-'));
    const bin = join(root, 'bin');
    const sshLog = join(root, 'ssh.log');
    mkdirSync(bin);

    executable(
      join(bin, 'ssh'),
      `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_SSH_LOG"
if [[ "$*" == *mktemp* ]]; then
  printf '%s\n' '/tmp/mcat-pull-X9a7Q2.db'
fi
`
    );
    executable(join(bin, 'rsync'), '#!/usr/bin/env bash\nexit 42\n');

    try {
      const result = spawnSync('bash', [PULL_SCRIPT], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          FAKE_SSH_LOG: sshLog,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(42);
      const calls = readFileSync(sshLog, 'utf8').trim().split('\n');
      expect(calls.some((call) => call.includes('mktemp'))).toBe(true);
      expect(calls.some((call) => call.includes(".backup '/tmp/mcat-pull-X9a7Q2.db'"))).toBe(true);
      expect(calls.some((call) => call.includes('rm -f -- /tmp/mcat-pull-X9a7Q2.db'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('warns about retained student data without replacing the original failure status', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcat-pull-test-'));
    const bin = join(root, 'bin');
    const sshLog = join(root, 'ssh.log');
    mkdirSync(bin);

    executable(
      join(bin, 'ssh'),
      `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_SSH_LOG"
if [[ "$*" == *mktemp* ]]; then
  printf '%s\n' '/tmp/mcat-pull-X9a7Q2.db'
elif [[ "$*" == *"rm -f --"* ]]; then
  exit 73
fi
`
    );
    executable(join(bin, 'rsync'), '#!/usr/bin/env bash\nexit 42\n');

    try {
      const result = spawnSync('bash', [PULL_SCRIPT], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          FAKE_SSH_LOG: sshLog,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(42);
      expect(result.stderr).toContain(
        'WARNING: could not remove remote snapshot vps:/tmp/mcat-pull-X9a7Q2.db - it may still contain real student data. Remove it manually.'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
