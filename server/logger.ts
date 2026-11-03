import { Writable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

/** Writes to a file and rotates it when it gets too big, keeping a fixed number of old files. */
export class RotatingFile extends Writable {
  private size = 0;
  private fd: number;

  constructor(
    private file: string,
    private maxBytes: number,
    private maxFiles: number,
  ) {
    super();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.fd = fs.openSync(file, 'a');
    this.size = fs.fstatSync(this.fd).size;
  }

  private rotate() {
    fs.closeSync(this.fd);
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
      const to = `${this.file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    this.fd = fs.openSync(this.file, 'w');
    this.size = 0;
  }

  _write(chunk: Buffer, _enc: BufferEncoding, done: (err?: Error | null) => void) {
    try {
      if (this.size > 0 && this.size + chunk.length > this.maxBytes) this.rotate();
      fs.writeSync(this.fd, chunk);
      this.size += chunk.length;
      done();
    } catch (err) {
      done(err as Error);
    }
  }

  _final(done: (err?: Error | null) => void) {
    try {
      fs.closeSync(this.fd);
      done();
    } catch (err) {
      done(err as Error);
    }
  }
}

/** One stream that goes to the journal (stdout) and to the size-limited file. */
export function logStream(dir: string, maxBytes: number, maxFiles: number): Writable {
  const file = new RotatingFile(path.join(dir, 'tactful.log'), maxBytes, maxFiles);
  return new Writable({
    write(chunk, _enc, done) {
      process.stdout.write(chunk);
      file.write(chunk, done);
    },
    final(done) {
      file.end(done);
    },
  });
}
