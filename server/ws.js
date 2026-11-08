/* Minimal dependency-free WebSocket server (RFC 6455, text frames).
   The arcade's whole point is that it has no dependencies; the handshake and
   frame codec are small enough that pulling in `ws` would cost more than it
   saves. Handles: upgrade handshake, masked client frames, fragmentation,
   ping/pong, close, and payloads up to 2^53-1 bytes. */
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

class Socket extends EventEmitter {
  constructor(raw) {
    super();
    this.raw = raw;
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.frag = null;          // { op, chunks[] }
    this.isAlive = true;

    raw.on('data', (d) => this._onData(d));
    raw.on('close', () => this._die());
    raw.on('error', () => this._die());
    raw.setTimeout(0);
    raw.setNoDelay(true);
  }

  _die() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    // decode as many whole frames as the buffer holds
    for (;;) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handle(frame);
      if (!this.open) break;
    }
  }

  _readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;

    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) { this.close(1009); return null; }
      len = Number(big); off += 8;
    }

    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.subarray(off, off + 4); off += 4;
    }
    if (b.length < off + len) return null;

    const payload = Buffer.from(b.subarray(off, off + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + len);
    return { fin, op, payload };
  }

  _handle(f) {
    switch (f.op) {
      case OP.PING: this._send(OP.PONG, f.payload); return;
      case OP.PONG: this.isAlive = true; return;
      case OP.CLOSE: this.close(1000); return;
      case OP.CONT:
        if (!this.frag) return;
        this.frag.chunks.push(f.payload);
        if (f.fin) {
          const whole = Buffer.concat(this.frag.chunks);
          const op = this.frag.op;
          this.frag = null;
          if (op === OP.TEXT) this.emit('message', whole.toString('utf8'));
        }
        return;
      case OP.TEXT:
      case OP.BIN:
        if (!f.fin) { this.frag = { op: f.op, chunks: [f.payload] }; return; }
        if (f.op === OP.TEXT) this.emit('message', f.payload.toString('utf8'));
        return;
      default: this.close(1002);
    }
  }

  _send(op, payload) {
    if (!this.open) return false;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.allocUnsafe(2);
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.allocUnsafe(4);
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.allocUnsafe(10);
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    head[0] = 0x80 | op;            // FIN + opcode; server frames are unmasked
    try {
      return this.raw.write(Buffer.concat([head, payload]));
    } catch (e) {
      this._die();
      return false;
    }
  }

  send(text) {
    return this._send(OP.TEXT, Buffer.from(String(text), 'utf8'));
  }

  ping() {
    this.isAlive = false;
    this._send(OP.PING, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.allocUnsafe(2);
    p.writeUInt16BE(code, 0);
    this._send(OP.CLOSE, p);
    this.open = false;
    try { this.raw.end(); } catch (e) {}
    this.emit('close');
  }
}

/* Attach to a node http.Server. onConnection(socket, request) */
function attach(httpServer, path, onConnection) {
  httpServer.on('upgrade', (req, socket, head) => {
    if (path && req.url.split('?')[0] !== path) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const ws = new Socket(socket);
    if (head && head.length) ws._onData(head);
    onConnection(ws, req);
  });
}

module.exports = { attach, Socket };
