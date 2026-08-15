import { spawn, ChildProcess } from "node:child_process";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import { OpenCodeRawEvent } from "../events/types";
import { SandboxEnvironment } from "./sandbox";

export class OrchestratedProcess extends EventEmitter {
  private child!: ChildProcess;
  private isClosed = false;

  constructor(
    private binaryPath: string,
    private prompt: string,
    private env: SandboxEnvironment,
    private userId: string,
    private customArgs?: string[]
  ) {
    super();
  }

  start(): void {
    let spawnArgs: string[];

    if (this.customArgs) {
      spawnArgs = this.customArgs;
    } else if (this.binaryPath === "node") {
      if (this.prompt.startsWith("-e ")) {
        let script = this.prompt.slice(3).trim();
        if (
          (script.startsWith("'") && script.endsWith("'")) ||
          (script.startsWith('"') && script.endsWith('"'))
        ) {
          script = script.slice(1, -1);
        }
        spawnArgs = ["-e", script];
      } else {
        spawnArgs = [this.prompt];
      }
    } else {
      spawnArgs = ["run", "--format", "json", this.prompt];
    }

    this.child = spawn(this.binaryPath, spawnArgs, {
      cwd: this.env.workspacePath,
      env: {
        ...process.env,
        HOME: this.env.homePath,
        USER: `tenant_${this.userId}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (this.child.stdout) {
      const rl = readline.createInterface({ input: this.child.stdout });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const parsed = JSON.parse(line) as OpenCodeRawEvent;
          this.emit("event", parsed);
        } catch {
          this.emit("raw_log", line);
        }
      });
    }

    this.child.stderr?.on("data", (data) => {
      this.emit("stderr", data.toString());
    });

    this.child.on("error", (err) => {
      this.emit("error", err);
    });

    this.child.on("close", (code) => {
      if (!this.isClosed) {
        this.isClosed = true;
        this.emit("event", { type: "done", data: { exitCode: code ?? 0 } });
        this.emit("closed", code ?? 0);
      }
    });
  }

  writeStdin(payload: Record<string, any>): void {
    if (!this.child || this.child.killed || !this.child.stdin?.writable) {
      throw new Error("Process standard input is unavailable or closed.");
    }
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (this.child && !this.child.killed) {
      this.child.kill(signal);
    }
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }
}
