import { StringDecoder } from "node:string_decoder";

export class BoundedUtf8Collector {
  readonly maxBytes: number;
  exceeded = false;

  private readonly decoder = new StringDecoder("utf8");
  private readonly chunks: string[] = [];
  private bytes = 0;

  constructor(maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError("maxBytes must be a positive integer.");
    }
    this.maxBytes = maxBytes;
  }

  write(data: Uint8Array): void {
    const remaining = this.maxBytes - this.bytes;
    if (remaining <= 0) {
      this.exceeded = true;
      return;
    }
    const accepted = data.byteLength > remaining ? data.subarray(0, remaining) : data;
    this.bytes += accepted.byteLength;
    this.chunks.push(this.decoder.write(accepted));
    if (accepted.byteLength !== data.byteLength) this.exceeded = true;
  }

  end(): string {
    this.chunks.push(this.decoder.end());
    return this.chunks.join("");
  }
}
