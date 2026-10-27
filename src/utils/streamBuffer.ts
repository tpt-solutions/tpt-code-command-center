// Upstream streams are kept as text for token accounting and Silent Edit. An unbounded buffer
// grows with every reply, so past the head limit only the tail is kept. Usage figures arrive
// at the end of a stream, which is why the tail is kept rather than dropping everything.
export const STREAM_HEAD_MAX_BYTES = 8 * 1024 * 1024;
export const STREAM_TAIL_MAX_BYTES = 256 * 1024;

export class StreamBuffer {
  private head: Buffer[] = [];
  private headBytes = 0;
  private tail: Buffer[] = [];
  private tailBytes = 0;
  private truncated = false;

  constructor(
    private readonly headMax = STREAM_HEAD_MAX_BYTES,
    private readonly tailMax = STREAM_TAIL_MAX_BYTES
  ) {}

  push(chunk: Buffer): void {
    let rest = chunk;
    if (this.headBytes < this.headMax) {
      const take = Math.min(rest.length, this.headMax - this.headBytes);
      this.head.push(rest.subarray(0, take));
      this.headBytes += take;
      rest = rest.subarray(take);
    }
    if (rest.length === 0) return;

    this.truncated = true;
    this.tail.push(rest);
    this.tailBytes += rest.length;
    // Trim once the tail is twice its limit, so the copy happens rarely rather than per chunk
    if (this.tailBytes > this.tailMax * 2) {
      const all = Buffer.concat(this.tail);
      const kept = all.subarray(all.length - this.tailMax);
      this.tail = [kept];
      this.tailBytes = kept.length;
    }
  }

  // True once bytes were dropped from the middle of the stream
  get wasTruncated(): boolean {
    return this.truncated;
  }

  text(): string {
    const head = Buffer.concat(this.head).toString('utf8');
    if (!this.truncated) return head;
    const tail = Buffer.concat(this.tail).toString('utf8');
    // The newline keeps a cut-off head line from fusing with the first line of the tail
    return head + '\n' + tail;
  }
}
