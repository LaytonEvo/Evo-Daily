/**
 * Temporary password generation, shared by the bootstrap script and the admin
 * "Add person" form so both produce the same shape of password.
 *
 * Deliberately free of any server-only dependency — lib/password.ts pulls in
 * bcrypt, which has no business in a browser bundle. This uses Web Crypto,
 * which Node and the browser both provide.
 */

/**
 * No O/0, l/1/I. These passwords get read down a phone and typed by hand, and
 * an ambiguous character turns a 10-second job into a support call.
 */
export const PASSWORD_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Uniformly random indexes into the alphabet.
 *
 * A plain `byte % length` would bias toward the front of the alphabet, since
 * 256 is not a multiple of it. Drawing again on the overflow costs nothing and
 * keeps every character equally likely.
 */
function randomIndexes(count: number, length: number): number[] {
  const limit = Math.floor(256 / length) * length;
  const out: number[] = [];

  while (out.length < count) {
    const bytes = new Uint8Array(count - out.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) out.push(byte % length);
    }
  }

  return out;
}

/**
 * A temporary password, e.g. "KFBZXF3-PiBUsCB". The hyphen is a visual break
 * that also satisfies any policy expecting punctuation. Nobody keeps one of
 * these — every account it is set on must change it at first sign-in.
 */
export function generatePassword(length = 14): string {
  const indexes = randomIndexes(length, PASSWORD_ALPHABET.length);
  const chars = indexes.map((i) => PASSWORD_ALPHABET[i]).join("");
  return `${chars.slice(0, 7)}-${chars.slice(7)}`;
}
