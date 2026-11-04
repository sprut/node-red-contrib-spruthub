const crypto = require('crypto');
const { argon2id } = require('hash-wasm');

// Auth v2 (challenge-response): the password never leaves the client.
//   seed      = Argon2id(password, rootSalt, kdfParams), 32 bytes
//   signature = Ed25519.sign(challenge, seed)
// All parameters come from the server in the CHALLENGE question data:
//   {"rootSalt": base64, "kdfParams": "m=..,t=..,p=..", "challenge": base64}

// PKCS#8 DER header for a raw 32-byte Ed25519 private key (seed)
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function parseKdfParams(kdfParams) {
  const values = {};
  String(kdfParams || '').split(',').forEach((param) => {
    const [key, value] = param.split('=');
    values[key.trim()] = Number(value);
  });

  const { m, t, p } = values;
  if (!m || !t || !p) {
    throw new Error('Invalid kdfParams: ' + kdfParams);
  }
  return { m, t, p };
}

async function deriveSeed(password, rootSalt, kdfParams) {
  const { m, t, p } = parseKdfParams(kdfParams);
  const seed = await argon2id({
    password: password,
    salt: Buffer.from(rootSalt, 'base64'),
    memorySize: m,
    iterations: t,
    parallelism: p,
    hashLength: 32,
    outputType: 'binary',
  });
  return Buffer.from(seed);
}

function ed25519PrivateKey(seed) {
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

// Answer to QUESTION_TYPE_CHALLENGE: base64 Ed25519 signature of the challenge
async function signChallenge(password, data) {
  if (typeof data === 'string') {
    data = JSON.parse(data);
  }
  if (!data || !data.rootSalt || !data.kdfParams || !data.challenge) {
    throw new Error('Invalid challenge data');
  }

  const seed = await deriveSeed(password, data.rootSalt, data.kdfParams);
  const signature = crypto.sign(null, Buffer.from(data.challenge, 'base64'), ed25519PrivateKey(seed));
  return signature.toString('base64');
}

module.exports = {
  parseKdfParams,
  deriveSeed,
  ed25519PrivateKey,
  signChallenge,
};
