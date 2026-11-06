// SHA-256 of file content: the identity of a DigitalCopy (not the file name or Drive id).

const tag = (v) => Object.prototype.toString.call(v);

async function toBytes(data) {
  // realm-safe checks (jsdom and Node have different ArrayBuffer/Uint8Array constructors)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (tag(data) === "[object ArrayBuffer]") return new Uint8Array(data);
  if (data && typeof data === "object") {
    if (typeof data.arrayBuffer === "function") return new Uint8Array(await data.arrayBuffer()); // Blob / File
    if (typeof FileReader !== "undefined") { // environments whose Blob lacks arrayBuffer()
      return new Uint8Array(await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = () => rej(r.error);
        r.readAsArrayBuffer(data);
      }));
    }
  }
  throw new TypeError("sha256Hex expects an ArrayBuffer, typed array or Blob");
}

export async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", await toBytes(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isSha256Hex = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
