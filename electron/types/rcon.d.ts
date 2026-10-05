declare module 'rcon' {
  import { EventEmitter } from 'events';

  /** node-rcon 1.x. Emits 'auth', 'response' (string), 'server', 'error' and 'end'. */
  class Rcon extends EventEmitter {
    constructor(host: string, port: number, password: string, options?: { tcp?: boolean; challenge?: boolean; id?: number });
    connect(): void;
    /** Half-closes the socket; the connection lingers if the server never answers. */
    disconnect(): void;
    send(data: string, cmd?: number, id?: number): void;
  }

  export = Rcon;
}
