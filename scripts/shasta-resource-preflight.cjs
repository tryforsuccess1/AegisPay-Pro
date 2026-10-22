'use strict';

const crypto = require('node:crypto');

const API_BASE = 'https://api.shasta.trongrid.io';
const SHASTA_USDT = 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs';
const WALLET = String(process.env.AEGIS_SHASTA_PREFLIGHT_WALLET || 'TPXkczErK2Bo66MMU9HxYvnPFqB6mGYTTJ').trim();
const MIN_TRX_SUN = 120_000_000n;
const MIN_TRX_WITH_ENERGY_SUN = 1_000_000n;
const MIN_ENERGY = 100_000;
const TOKEN_DECIMALS = 6;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function base58CheckPayload(address) {
  let n = 0n;
  for (const c of address) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) throw new Error('invalid Base58 character');
    n = n * 58n + BigInt(digit);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
  const leadingOnes = (address.match(/^1*/) || [''])[0].length;
  if (leadingOnes) bytes = Buffer.concat([Buffer.alloc(leadingOnes), bytes]);
  if (bytes.length !== 25) throw new Error('unexpected Base58Check address length');
  const payload = bytes.subarray(0, 21);
  const checksum = bytes.subarray(21);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.equals(expected)) throw new Error('Base58Check checksum mismatch');
  if (payload[0] !== 0x41) throw new Error('address is not a TRON address');
  return payload;
}

function balanceOfParameter(address) {
  const payload = base58CheckPayload(address);
  return payload.subarray(1).toString('hex').padStart(64, '0');
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  if (payload && payload.Error) throw new Error(`${path} returned an API error`);
  return payload;
}

function formatRaw(value, decimals) {
  const raw = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  return `${raw / scale}.${(raw % scale).toString().padStart(decimals, '0')}`;
}

async function main() {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(WALLET)) throw new Error('invalid Shasta test wallet format');
  const parameter = balanceOfParameter(WALLET);
  const [account, resources, token] = await Promise.all([
    postJson('/wallet/getaccount', { address: WALLET, visible: true }),
    postJson('/wallet/getaccountresource', { address: WALLET, visible: true }),
    postJson('/wallet/triggerconstantcontract', {
      owner_address: WALLET,
      contract_address: SHASTA_USDT,
      function_selector: 'balanceOf(address)',
      parameter,
      visible: true,
    }),
  ]);

  if (token?.result?.result !== true || !Array.isArray(token.constant_result) || !token.constant_result[0]) {
    throw new Error('Shasta USDT balanceOf query did not return a valid constant result');
  }
  const trxSun = BigInt(String(account.balance || '0'));
  const usdtRaw = BigInt(`0x${String(token.constant_result[0]).replace(/^0x/i, '')}`);
  const energyLimit = Number(resources.EnergyLimit ?? resources.energy_limit ?? 0);
  const energyUsed = Number(resources.EnergyUsed ?? resources.energy_used ?? 0);
  const availableEnergy = Math.max(0, energyLimit - energyUsed);
  const resourcesSufficient = trxSun >= MIN_TRX_SUN ||
    (trxSun >= MIN_TRX_WITH_ENERGY_SUN && availableEnergy >= MIN_ENERGY);
  const ready = usdtRaw > 0n && resourcesSufficient;

  console.log('SHASTA_PREFLIGHT_NETWORK=TRON_TESTNET');
  console.log(`SHASTA_PREFLIGHT_WALLET=${WALLET}`);
  console.log(`SHASTA_PREFLIGHT_USDT=${formatRaw(usdtRaw, TOKEN_DECIMALS)}`);
  console.log(`SHASTA_PREFLIGHT_TRX=${formatRaw(trxSun, 6)}`);
  console.log(`SHASTA_PREFLIGHT_AVAILABLE_ENERGY=${availableEnergy}`);
  console.log('SHASTA_PREFLIGHT_REQUIRED_USDT_RAW=>0');
  console.log(`SHASTA_PREFLIGHT_RESOURCE_POLICY=${resourcesSufficient ? 'PASS' : 'NOT_READY'}`);
  console.log(`SHASTA_PREFLIGHT_SWEEP_POSSIBLE=${ready ? 'YES_RESOURCE_CHECK_ONLY' : 'NO'}`);
  console.log('SHASTA_PREFLIGHT_EFFECT=READ_ONLY; NO TRANSACTION SIGNED OR BROADCAST');
  console.log('Note: resource readiness alone does not authorize a sweep; fresh verified source evidence and independent secret-separation verification remain required.');
}

main().catch((error) => {
  console.error('SHASTA_PREFLIGHT=INCONCLUSIVE');
  console.error(String(error && error.message || error));
  process.exitCode = 1;
});
