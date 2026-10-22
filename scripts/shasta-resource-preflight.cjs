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

async function getConfirmedInboundTransfers() {
  const url = new URL(`${API_BASE}/v1/accounts/${encodeURIComponent(WALLET)}/transactions/trc20`);
  url.searchParams.set('only_confirmed', 'true');
  url.searchParams.set('only_to', 'true');
  url.searchParams.set('limit', '200');
  url.searchParams.set('order_by', 'block_timestamp,desc');
  url.searchParams.set('contract_address', SHASTA_USDT);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { status: 'INCONCLUSIVE', code: `HTTP_${response.status}`, transfers: [], totalRaw: 0n, limitReached: false };
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const seen = new Set();
    const transfers = [];
    let invalidRows = 0;
    for (const row of rows) {
      const txid = String(row?.transaction_id || '').toLowerCase();
      const to = String(row?.to || '');
      const contract = String(row?.token_info?.address || row?.contract_address || '');
      const raw = String(row?.value || '0');
      const timestamp = Number(row?.block_timestamp || 0);
      if (!/^[a-f0-9]{64}$/.test(txid) || to !== WALLET || contract !== SHASTA_USDT ||
          row?.success === false || !Number.isSafeInteger(timestamp) || timestamp <= 0 || !/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
        invalidRows++;
        continue;
      }
      if (seen.has(txid)) continue;
      seen.add(txid);
      transfers.push({ txid, rawAmount: BigInt(raw).toString(), blockTimestamp: timestamp });
    }
    const totalRaw = transfers.reduce((sum, item) => sum + BigInt(item.rawAmount), 0n);
    const limitReached = rows.length >= 200;
    const status = invalidRows ? 'INVALID_ROWS' : limitReached ? 'HISTORY_LIMIT_REACHED' : 'OK';
    return { status, code: invalidRows ? `INVALID_ROWS_${invalidRows}` : limitReached ? 'QUERY_LIMIT_REACHED' : 'NONE',
      transfers, totalRaw, limitReached, returnedRows: rows.length };
  } catch (error) {
    return { status: 'INCONCLUSIVE', code: String(error && error.message || error).replace(/[^A-Za-z0-9_. -]/g, '').slice(0, 120),
      transfers: [], totalRaw: 0n, limitReached: false };
  }
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
  const inbound = await getConfirmedInboundTransfers();
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
  console.log(`SHASTA_PREFLIGHT_INBOUND_HISTORY_STATUS=${inbound.status}`);
  console.log(`SHASTA_PREFLIGHT_INBOUND_HISTORY_CODE=${inbound.code}`);
  console.log(`SHASTA_PREFLIGHT_CONFIRMED_INBOUND_TRANSFER_COUNT=${inbound.transfers.length}`);
  console.log(`SHASTA_PREFLIGHT_CONFIRMED_INBOUND_USDT=${formatRaw(inbound.totalRaw, TOKEN_DECIMALS)}`);
  console.log(`SHASTA_PREFLIGHT_INBOUND_HISTORY_LIMIT_REACHED=${inbound.limitReached ? 'YES' : 'NO'}`);
  for (const item of inbound.transfers.slice(0, 20)) {
    console.log(`SHASTA_PREFLIGHT_INBOUND_TX=${item.txid}:${formatRaw(item.rawAmount, TOKEN_DECIMALS)}:block_ms_${item.blockTimestamp}`);
  }
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
