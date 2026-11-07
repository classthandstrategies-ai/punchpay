/** An error whose message and status are safe to send to the browser. Client-safe (no server imports). */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
