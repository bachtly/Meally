import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

type Sink = (chunk: Uint8Array, final: boolean) => void;

/** Streaming zip writer. Images are stored as they are (already compressed); everything else is deflated. */
export class ZipWriter {
  private zip: Zip;
  constructor(
    sink: Sink,
    private pause: () => Promise<void> = async () => {},
  ) {
    this.zip = new Zip((err, chunk, final) => {
      if (err) throw err;
      sink(chunk, final);
    });
  }

  addBuffer(name: string, data: Uint8Array, store = false) {
    const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    this.zip.add(f);
    f.push(data, true);
  }

  /** Starts a streamed entry; push chunks with `final` set on the last one. */
  open(name: string, store = false) {
    const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    this.zip.add(f);
    return f;
  }

  /** Waits while the consumer is behind. */
  readonly drain = () => this.pause();

  end() {
    this.zip.end();
  }
}

/** A zip as a web stream for an HTTP response. `build` runs while the client reads. */
export function zipResponseStream(build: (z: ZipWriter) => Promise<void>): ReadableStream<Uint8Array> {
  let resume: (() => void) | null = null;
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      const z = new ZipWriter(
        (chunk) => ctrl.enqueue(chunk),
        async () => {
          if ((ctrl.desiredSize ?? 1) <= 0) await new Promise<void>((r) => (resume = r));
        },
      );
      build(z)
        .then(() => {
          z.end();
          ctrl.close();
        })
        .catch((e) => ctrl.error(e));
    },
    pull() {
      resume?.();
      resume = null;
    },
    cancel() {
      resume?.();
    },
  });
}
