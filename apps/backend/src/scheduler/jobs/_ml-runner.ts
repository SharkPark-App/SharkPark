import { spawn } from 'node:child_process';

/**
 * Path to the ML package root inside the runtime image. The Dockerfile
 * copies `services/ml/` into `/app/services/ml/` and creates a venv at
 * `/opt/venv` with the package installed editable via uv. Predict
 * scripts are runnable as `python -m scripts.predict_short_term`
 * from this directory.
 *
 * Overridable via env so local dev (running the scheduler against a
 * checkout instead of the built image) can point at the workspace path.
 */
export const ML_WORKDIR = process.env.ML_WORKDIR ?? '/app/services/ml';

/**
 * Python interpreter that has the `sharkpark-ml` package installed.
 * Defaults to the venv created by the Dockerfile; override with
 * `ML_PYTHON=$(uv run which python)` for local dev.
 */
export const ML_PYTHON = process.env.ML_PYTHON ?? '/opt/venv/bin/python';

export interface SpawnPythonResult {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
}

/**
 * Spawn a Python module under the ML venv and resolve once it exits.
 *
 * Streams stdout/stderr line-by-line into `onLog` so the calling job can
 * forward them to the structured Pino logger (each line becomes one JSON
 * log event in production, surfaced to Fly logs + Sentry breadcrumbs).
 *
 * Captures the last 64KiB of each stream into `stdoutTail` / `stderrTail`
 * so the job can include the most relevant output when raising on a
 * non-zero exit. Bounded buffer prevents OOM if the script becomes
 * pathologically chatty.
 *
 * Rejects if the process can't be spawned (ENOENT, EACCES). Resolves
 * with `exitCode != 0` for crashes — caller decides whether to throw.
 */
export function spawnPythonModule(
  moduleName: string,
  args: readonly string[],
  options: {
    onLog: (stream: 'stdout' | 'stderr', line: string) => void;
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
  },
): Promise<SpawnPythonResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ML_PYTHON, ['-u', '-m', moduleName, ...args], {
      cwd: ML_WORKDIR,
      // Inherit parent env (DATABASE_URL, MLFLOW_*, ML_R2_*, AWS_*) so
      // mlflow_setup.configure_mlflow() picks up the prod tracking URI.
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const TAIL_LIMIT = 64 * 1024;
    let stdoutTail = '';
    let stderrTail = '';
    let stdoutBuf = '';
    let stderrBuf = '';

    const handleChunk = (
      stream: 'stdout' | 'stderr',
      chunk: Buffer,
    ): void => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') {
        stdoutTail = (stdoutTail + text).slice(-TAIL_LIMIT);
        stdoutBuf += text;
        let nl: number;
        while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          if (line.length > 0) options.onLog('stdout', line);
        }
      } else {
        stderrTail = (stderrTail + text).slice(-TAIL_LIMIT);
        stderrBuf += text;
        let nl: number;
        while ((nl = stderrBuf.indexOf('\n')) !== -1) {
          const line = stderrBuf.slice(0, nl);
          stderrBuf = stderrBuf.slice(nl + 1);
          if (line.length > 0) options.onLog('stderr', line);
        }
      }
    };

    child.stdout.on('data', (c: Buffer) => handleChunk('stdout', c));
    child.stderr.on('data', (c: Buffer) => handleChunk('stderr', c));

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        // Sigterm gives the script a chance to flush logs / close
        // DB connections cleanly. cron-runner's outer maxRuntime
        // serves as a hard upper bound.
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      // Flush any unterminated trailing line.
      if (stdoutBuf.length > 0) options.onLog('stdout', stdoutBuf);
      if (stderrBuf.length > 0) options.onLog('stderr', stderrBuf);

      const exitCode = code ?? (signal ? 128 + 15 : -1);
      resolve({ exitCode, stdoutTail, stderrTail });
    });
  });
}
