// ═══════════════════════════════════════════════════════════════════════════
// Tesla SEI Telemetry Extractor
// Extracts embedded telemetry from Tesla dashcam MP4 files directly in browser.
// Tesla stores telemetry in H.264 SEI NAL units (type 6), encoded as protobuf.
// ═══════════════════════════════════════════════════════════════════════════

// Minimal protobuf decoder for Tesla SeiMetadata
// Proto schema:
//   1: uint32 version
//   2: enum gear_state (varint: 0=park, 1=drive, 2=reverse, 3=neutral)
//   3: uint64 frame_seq_no
//   4: float vehicle_speed_mps
//   5: float accelerator_pedal_position
//   6: float steering_wheel_angle
//   7: bool blinker_on_left
//   8: bool blinker_on_right
//   9: bool brake_applied
//  10: enum autopilot_state (varint: 0=none, 1=fsd, 2=autosteer, 3=tacc)
//  11: double latitude_deg
//  12: double longitude_deg
//  13: double heading_deg
//  14: double linear_acceleration_mps2_x
//  15: double linear_acceleration_mps2_y
//  16: double linear_acceleration_mps2_z

function decodeProtobufSei(buf) {
  const dv = buf instanceof DataView ? buf : new DataView(buf);
  const msg = {};
  let i = 0;

  while (i < dv.byteLength) {
    // Read field tag
    let tag = 0;
    let shift = 0;
    while (i < dv.byteLength) {
      const b = dv.getUint8(i++);
      tag |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;

    switch (wireType) {
      case 0: { // varint
        let val = 0n;
        let s = 0n;
        while (i < dv.byteLength) {
          const b = dv.getUint8(i++);
          val |= BigInt(b & 0x7f) << s;
          s += 7n;
          if (!(b & 0x80)) break;
        }
        msg[fieldNum] = Number(val);
        break;
      }
      case 1: { // 64-bit (double/float64) — protobuf is little-endian
        if (i + 8 <= dv.byteLength) {
          msg[fieldNum] = dv.getFloat64(i, true);
          i += 8;
        } else { i = dv.byteLength; }
        break;
      }
      case 5: { // 32-bit (float) — protobuf is little-endian
        if (i + 4 <= dv.byteLength) {
          msg[fieldNum] = dv.getFloat32(i, true);
          i += 4;
        } else { i = dv.byteLength; }
        break;
      }
      case 2: { // length-delimited (skip for now)
        let len = 0;
        let ls = 0;
        while (i < dv.byteLength) {
          const b = dv.getUint8(i++);
          len |= (b & 0x7f) << ls;
          ls += 7;
          if (!(b & 0x80)) break;
        }
        i += len;
        break;
      }
      default:
        i = dv.byteLength; // unknown wire type, stop
    }
  }

  // Map field numbers to names
  return {
    version: msg[1] || 0,
    gearState: msg[2] ?? 0,        // 0=park,1=drive,2=reverse,3=neutral
    frameSeqNo: msg[3] || 0,
    speedMps: msg[4] || 0,        // float
    accelPedal: msg[5] || 0,      // float
    steeringAngle: msg[6] || 0,   // float
    blinkerLeft: msg[7] === 1,
    blinkerRight: msg[8] === 1,
    brakeApplied: msg[9] === 1,
    autopilotState: msg[10] ?? 0, // 0=none,1=fsd,2=autosteer,3=tacc
    latitude: msg[11] || 0,      // double
    longitude: msg[12] || 0,     // double
    heading: msg[13] || 0,        // double
    accelX: msg[14] || 0,
    accelY: msg[15] || 0,
    accelZ: msg[16] || 0,
  };
}

// Remove H.264 emulation prevention bytes (0x03 after 0x00 0x00)
function removeEmulationPrevention(data) {
  const out = [];
  let zeros = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (zeros >= 2 && b === 0x03) {
      zeros = 0;
      continue;
    }
    out.push(b);
    if (b === 0x00) zeros++;
    else zeros = 0;
  }
  return new Uint8Array(out);
}

// Parse SEI messages from RBSP data
// Returns array of {payloadType, payloadBytes}
function parseSeiMessages(rbsp) {
  const data = removeEmulationPrevention(rbsp);
  const messages = [];
  let i = 0;

  while (i < data.length) {
    // payloadType
    let payloadType = 0;
    while (i < data.length && data[i] === 0xFF) {
      payloadType += 255;
      i++;
    }
    if (i >= data.length) break;
    payloadType += data[i++];

    // payloadSize
    let payloadSize = 0;
    while (i < data.length && data[i] === 0xFF) {
      payloadSize += 255;
      i++;
    }
    if (i >= data.length) break;
    payloadSize += data[i++];

    if (i + payloadSize > data.length) break;
    const payload = data.slice(i, i + payloadSize);
    i += payloadSize;
    messages.push({ payloadType, payload });
  }

  return messages;
}

// Try to decode a SEI payload as Tesla telemetry protobuf
function tryDecodeSei(payloadType, payload) {
  if (!payload || payload.length === 0) return null;

  let candidates = [];

  // Tesla uses type 5 (user_data_unregistered) with magic prefix 0x42...0x69
  if (payloadType === 5) {
    let i = 0;
    while (i < payload.length && payload[i] === 0x42) i++;
    if (i > 0 && i < payload.length && payload[i] === 0x69) {
      const start = i + 1;
      if (start < payload.length) {
        candidates.push(payload.slice(start));
      }
    }
    // Also try skipping UUID (16 bytes)
    if (payload.length > 16) {
      candidates.push(payload.slice(16));
    }
  }

  // Always try as-is
  candidates.push(payload);

  // Scan for protobuf start byte (0x08 = field 1, varint)
  const scanLen = Math.min(payload.length, 64);
  for (let i = 0; i < scanLen; i++) {
    if (payload[i] === 0x08 && i + 2 <= payload.length) {
      candidates.push(payload.slice(i));
    }
  }

  for (const cand of candidates) {
    if (cand.length === 0) continue;

    // Try with and without trailing stop byte (0x80)
    const attempts = [cand];
    if (cand.length > 1 && cand[cand.length - 1] === 0x80) {
      attempts.push(cand.slice(0, -1));
    }

    for (const attempt of attempts) {
      try {
        const view = new DataView(attempt.buffer, attempt.byteOffset || 0, attempt.byteLength);
        const msg = decodeProtobufSei(view);
        // Guard against false positives
        if (msg.version === 0 && msg.frameSeqNo === 0) continue;
        // Debug: dump raw hex of first successful decode
        if (!window._lastSeiPayloadHex) {
          const hexBytes = [];
          for (let h = 0; h < Math.min(attempt.length, 80); h++) {
            hexBytes.push(attempt[h].toString(16).padStart(2, '0'));
          }
          window._lastSeiPayloadHex = hexBytes.join(' ');
        }
        return msg;
      } catch(e) {
        // Not valid protobuf, try next
      }
    }
  }

  return null;
}

// Main: extract telemetry from an MP4 File
// Returns array of {timeOffset, speed, gps, steering, etc.}
async function extractTelemetryFromMp4(file, onProgress) {
  const buf = await file.arrayBuffer();
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // ── Parse MP4 boxes to find video track ──
  let offset = 0;
  let nalLenSize = 4; // default
  let stsz = [];      // sample sizes
  let stco = [];      // chunk offsets
  let stsc = [];      // sample-to-chunk
  let stts = [];      // time-to-sample (for timestamps)

  function readBox(pos) {
    if (pos + 8 > buf.byteLength) return null;
    const size = dv.getUint32(pos, false);
    const type = String.fromCharCode(...u8.slice(pos + 4, pos + 8));
    const headerLen = size === 1 ? 16 : 8;
    const realSize = size === 1 ? Number(dv.getBigUint64(pos + 8, false)) : size;
    return { type, size: realSize, headerLen, dataStart: pos + headerLen };
  }

  function parseBox(pos, end, depth) {
    while (pos + 8 <= end) {
      const box = readBox(pos);
      if (!box) break;
      const { type, size, headerLen, dataStart } = box;
      const dataEnd = pos + size;

      if (type === 'moov' || type === 'trak' || type == 'mdia' || type == 'minf' || type == 'stbl' || type === 'edts') {
        parseBox(dataStart, dataEnd, depth + 1);
      } else if (type === 'avcC' || type === 'hvcC') {
        // avcC: configurationVersion(1) + profile(1) + compat(1) + level(1) + reserved(6bits=0xFF) + nalLenSize-1(2bits) + reserved(3bits=0xFF) + numSps(2bits)
        if (dataStart + 5 <= buf.byteLength) {
          nalLenSize = (u8[dataStart + 4] & 0x03) + 1;
        }
      } else if (type === 'stsz') {
        // Sample sizes
        let p = dataStart + 12; // skip version/flags + sample_size + sample_count
        const count = dv.getUint32(dataStart + 8, false);
        stsz = [];
        for (let i = 0; i < count && p + 4 <= buf.byteLength; i++) {
          stsz.push(dv.getUint32(p, false));
          p += 4;
        }
      } else if (type === 'stco' || type === 'co64') {
        let p = dataStart + 8;
        const count = dv.getUint32(dataStart + 4, false);
        stco = [];
        for (let i = 0; i < count; i++) {
          if (type === 'stco') {
            stco.push(dv.getUint32(p, false));
            p += 4;
          } else {
            stco.push(Number(dv.getBigUint64(p, false)));
            p += 8;
          }
        }
      } else if (type === 'stsc') {
        let p = dataStart + 8;
        const count = dv.getUint32(dataStart + 4, false);
        stsc = [];
        for (let i = 0; i < count && p + 12 <= buf.byteLength; i++) {
          stsc.push({
            firstChunk: dv.getUint32(p, false),
            samplesPerChunk: dv.getUint32(p + 4, false),
            sampleDescIdx: dv.getUint32(p + 8, false)
          });
          p += 12;
        }
      } else if (type === 'stts') {
        let p = dataStart + 8;
        const count = dv.getUint32(dataStart + 4, false);
        stts = [];
        for (let i = 0; i < count && p + 8 <= buf.byteLength; i++) {
          stts.push({
            sampleCount: dv.getUint32(p, false),
            sampleDelta: dv.getUint32(p + 4, false)
          });
          p += 8;
        }
      }

      pos += size || 8;
    }
  }

  parseBox(0, buf.byteLength, 0);

  // Build sample offsets from stsc + stco
  const samples = [];
  if (stsz.length && stco.length && stsc.length) {
    let sampleIdx = 0;
    for (let ci = 0; ci < stco.length; ci++) {
      // Find which stsc entry applies
      let spc = 1;
      for (let si = stsc.length - 1; si >= 0; si--) {
        if (ci + 1 >= stsc[si].firstChunk) {
          spc = stsc[si].samplesPerChunk;
          break;
        }
      }
      let offset = stco[ci];
      for (let j = 0; j < spc && sampleIdx < stsz.length; j++) {
        samples.push({ offset, size: stsz[sampleIdx] });
        offset += stsz[sampleIdx];
        sampleIdx++;
      }
    }
  }

  // Build timestamps from stts
  const sampleTimes = [];
  let time = 0;
  let sIdx = 0;
  for (let si = 0; si < stts.length && sIdx < samples.length; si++) {
    for (let j = 0; j < stts[si].sampleCount && sIdx < samples.length; j++) {
      sampleTimes.push(time);
      time += stts[si].sampleDelta;
      sIdx++;
    }
  }

  // ── Extract SEI from each sample ──
  const telemetry = [];
  let lastProgressReport = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.size < 1) continue;
    const sampleData = u8.slice(s.offset, s.offset + s.size);

    // Split into NAL units (length-prefixed)
    let pos = 0;
    while (pos + nalLenSize <= sampleData.length) {
      let nalLen = 0;
      for (let b = 0; b < nalLenSize; b++) {
        nalLen = (nalLen << 8) | sampleData[pos + b];
      }
      pos += nalLenSize;
      if (pos + nalLen > sampleData.length || nalLen === 0) break;

      const nal = sampleData.slice(pos, pos + nalLen);
      pos += nalLen;

      if (nal.length === 0) continue;
      const nalType = nal[0] & 0x1F; // H.264 NAL type

      if (nalType === 6) { // SEI
        const rbsp = nal.slice(1);
        const messages = parseSeiMessages(rbsp);
        for (const msg of messages) {
          const decoded = tryDecodeSei(msg.payloadType, msg.payload);
          if (decoded) {
            decoded.timeOffset = sampleTimes[i] || (i * (1/30)); // fallback 30fps
            telemetry.push(decoded);
          }
        }
      }
    }

    // Report progress
    if (onProgress && i - lastProgressReport >= 50) {
      onProgress(i, samples.length);
      lastProgressReport = i;
    }
  }

  return telemetry;
}

// ── Format helpers ──
const GEAR_NAMES = ['P', 'D', 'R', 'N'];
const AUTOPILOT_NAMES = ['OFF', 'FSD', 'Autosteer', 'TACC'];

function formatSpeed(mps) {
  return (mps * 3.6).toFixed(1); // m/s → km/h
}

function formatSteering(angle) {
  return angle.toFixed(0) + '°';
}
