import { createSocket } from "dgram";

// Sends a standard Wake-on-LAN "magic packet": 6 bytes of 0xFF followed by
// the target MAC address repeated 16 times, broadcast over UDP. Only wakes
// devices on the same local network (or behind a router that forwards WoL
// broadcasts) — see docs/ROADMAP.md for that limitation.
export function sendMagicPacket(mac: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const bytes = mac.split(/[:-]/).map((b) => parseInt(b, 16));
    if (bytes.length !== 6 || bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
      reject(new Error("Ongeldig MAC-adres"));
      return;
    }
    const macBuffer = Buffer.from(bytes);
    const packet = Buffer.alloc(6 + 16 * 6);
    packet.fill(0xff, 0, 6);
    for (let i = 0; i < 16; i++) macBuffer.copy(packet, 6 + i * 6);

    const socket = createSocket("udp4");
    socket.once("error", (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, 9, "255.255.255.255", (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
