(function () {
  "use strict";

  const BLOCK_0_HEX = "268ea2dd4b1dbec8";
  const BLOCK_1_MAP = {
    0: "b2e21fcbcf6df76d", 1: "920694d567b2a07d", 2: "9b7d9b3e9ec105b3",
    3: "98e2032e347b3591", 4: "3163c73fbe1a4ffa", 5: "45abc8a31a02ea9f",
    6: "a9fb9b1b0249787f", 7: "bfdbe907efc33064", 8: "d77d20021f080cab",
    9: "2719e91949656f1b", A: "b73b243532d8502e", B: "34b9b4bc32d17b8e",
    C: "8d11170734f47d56", D: "8487ea725540e922", E: "414d4d7639f52efb",
    F: "3488819e28a84faf"
  };
  const BLOCK_2_MAP = {
    0: "ec47a53b333a619e", 1: "2a935d5bbcd64d62", 2: "163c36b43ae1d4fa",
    3: "b2c8f1b1b33c9d81", 4: "f5dd5a8a7c0cf9b0", 5: "8e54348d52c70597",
    6: "4da157ce4aaf762e", 7: "397cf2d9b2390038", 8: "3b8def964df8b50a",
    9: "1c2c11d4ded14e5a", A: "ba7c8877b591bb52", B: "6b50a8b78d6fd8b4",
    C: "3b5822cbe634c13a", D: "e02919d91e0a66d3", E: "52e9caee7f1a51d4",
    F: "5c5d710f55cc6978"
  };
  const VALID_DEVICE_SUFFIXES = [
    "163c36b43ae1d4fa", "f5dd5a8a7c0cf9b0", "4da157ce4aaf762e",
    "3b8def964df8b50a", "ec47a53b333a619e"
  ];
  const DEFAULT_N_BT = "366b36373669396f4b4a396f6a6f456c6b5730374976582b547344706d5a7275654e34567a5777787167516776396148656d565550773d3d";
  const DEFAULT_LIVE_DATA = "946b2cd8-d75c-11f0-b76f-a304a7c797c8LiveDataV6;1766172909";

  function hexToBytes(hex) {
    const value = String(hex).replace(/[\t\n\v\f\r ]/g, "");
    if (value.length % 2 || (value && !/^[0-9a-f]+$/i.test(value))) {
      throw new Error("Informe uma sequência hexadecimal válida e com número par de caracteres.");
    }
    return Uint8Array.from(value.match(/.{2}/g), pair => parseInt(pair, 16));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function asciiToHex(value) {
    return Array.from(value, char => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function secureBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function encodeSnToken(mac) {
    const clean = String(mac).trim().toUpperCase();
    const parts = clean.split(":");
    const lastByte = parts.length === 6 ? parts[5] : clean.length === 12 ? clean.slice(10, 12) : clean.slice(15, 17);
    const firstNibble = BLOCK_1_MAP[lastByte[0]] ? lastByte[0] : "6";
    const secondNibble = BLOCK_2_MAP[lastByte[1]] ? lastByte[1] : "F";
    const bytes = hexToBytes(BLOCK_0_HEX + BLOCK_1_MAP[firstNibble] + BLOCK_2_MAP[secondNibble]);
    const base64 = bytesToBase64(bytes);
    return { hex: asciiToHex(base64), base64 };
  }

  function generateDeviceId() {
    const block = secureBytes(8);
    const suffix = hexToBytes(VALID_DEVICE_SUFFIXES[Math.floor(Math.random() * VALID_DEVICE_SUFFIXES.length)]);
    const bytes = new Uint8Array(16);
    bytes.set(block, 0);
    bytes.set(suffix, 8);
    const base64 = bytesToBase64(bytes);
    return { hex: asciiToHex(base64), base64 };
  }

  function randomUserId() {
    return `5${Math.floor(10000000 + Math.random() * 90000000)}`;
  }

  function randomUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = secureBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function javaDateHeader(date = new Date()) {
    const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = number => String(number).padStart(2, "0");
    return `#${days[shifted.getUTCDay()]} ${months[shifted.getUTCMonth()]} ${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} GMT+08:00 ${shifted.getUTCFullYear()}`;
  }

  function xmlEscape(value) {
    return String(value).replace(/[<>&"']/g, char => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
    })[char]);
  }

  function generateXml(mac, userId, channelCode, uuid) {
    const now = Date.now();
    const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
    const column0 = now - randomBetween(100000000, 300000000);
    const recommends = now - randomBetween(10000000, 50000000);
    const column1 = now - randomBetween(1000, 5000);
    const column2 = column1 + randomBetween(100, 500);
    const column6 = column1 + randomBetween(200, 600);
    const realtime = randomBetween(5000000, 6000000);
    const cleanMac = mac.trim().toUpperCase();
    const channel = xmlEscape(channelCode || "SBTHD");

    return `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="live_last_channel_code">${channel}</string>
    <string name="unitvsiptv_free"></string>
    <string name="unitvsiptv_live"></string>
    <int name="recommends_cache_time" value="96" />
    <int name="all_Column_key" value="68143" />
    <long name="service_time_column_10002" value="${column2}" />
    <long name="service_time_column_10001" value="${column1}" />
    <long name="service_time_column_10006" value="${column6}" />
    <int name="live_last_column_id" value="68143" />
    <string name="key_user_id">${xmlEscape(userId)}</string>
    <long name="service_time_column_0" value="${column0}" />
    <string name="KEY_SP_SN">${xmlEscape(cleanMac)}</string>
    <string name="_free"></string>
    <string name="_special"></string>
    <string name="Special_root"></string>
    <string name="SP_SN_BACKUP">${xmlEscape(cleanMac)},1</string>
    <int name="column_cache_time" value="65" />
    <string name="_live"></string>
    <string name="key_user_identity">4</string>
    <int name="live_last_tab" value="3" />
    <string name="_search"></string>
    <string name="unitvsiptv_special"></string>
    <int name="heartbeat_cache_time" value="120" />
    <long name="dcs_realtime" value="${realtime}" />
    <string name="key_n_bt">${uuid}</string>
    <string name="key_device_id_unitvfree">${xmlEscape(userId)}</string>
    <string name="cache_key_recommend"></string>
    <string name="unitvsiptv_search"></string>
    <string name="68143">${DEFAULT_LIVE_DATA}</string>
    <string name="key_renew_flag">0</string>
    <long name="service_time_recommends" value="${recommends}" />
</map>
`;
  }

  function generateConfig(options = {}) {
    const mac = String(options.mac || "9C:00:D3:EC:AA:01").trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
      throw new Error("MAC inválido. Use o formato 00:11:22:AA:BB:CC.");
    }
    const folder = sanitizeFolder(options.folder || "CONFIG_NEW");
    const userId = String(options.userId || randomUserId()).trim();
    const channelCode = String(options.channelCode || "SBTHD").trim();
    const device = options.deviceId ? { hex: String(options.deviceId).trim() } : generateDeviceId();
    if (!device.hex || !/^(?:[0-9a-f]{2})+$/i.test(device.hex)) {
      throw new Error("Device ID inválido. Informe o valor codificado em hexadecimal.");
    }
    const token = encodeSnToken(mac);
    const content = [
      "#personal info",
      javaDateHeader(),
      `key_n_bt=${DEFAULT_N_BT}`,
      `key_device_id_unitvfree=${device.hex}`,
      `key_sn_token_unitvfree=${token.hex}`,
      ""
    ].join("\n");
    const uuid = randomUuid();
    return {
      folder_name: folder,
      mac,
      user_id: userId,
      device_id_hex: device.hex,
      device_id_b64: device.base64 || "",
      sn_token_hex: token.hex,
      sn_token_b64: token.base64,
      uuid,
      files: {
        ".config": content,
        ".properties": content,
        "cache.config.xml": generateXml(mac, userId, channelCode, uuid)
      }
    };
  }

  function sanitizeFolder(value) {
    const folder = String(value || "CONFIG").trim().replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+$/, "");
    return folder || "CONFIG";
  }

  function generateRandomMac() {
    return Array.from(secureBytes(6), byte => byte.toString(16).padStart(2, "0").toUpperCase()).join(":");
  }

  function decodeHex(value) {
    try {
      const bytes = hexToBytes(value);
      const text = new TextDecoder("utf-8").decode(bytes);
      let base64Hex = "";
      try {
        const cleaned = text.replace(/[^A-Za-z0-9+/=]/g, "");
        const decoded = Uint8Array.from(atob(cleaned), char => char.charCodeAt(0));
        base64Hex = bytesToHex(decoded);
      } catch (_) {
        base64Hex = "";
      }
      return { success: true, hex: String(value).trim(), text, b64_hex: base64Hex };
    } catch (error) {
      return { success: false, hex: String(value).trim(), error: error.message };
    }
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function joinBytes(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  }

  function createZip(entries) {
    const encoder = new TextEncoder();
    const localChunks = [];
    const centralChunks = [];
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0;

    const writeHeader = (size, fields) => {
      const buffer = new ArrayBuffer(size);
      const view = new DataView(buffer);
      for (const [method, args] of fields) view[method](...args);
      return new Uint8Array(buffer);
    };

    entries.forEach(entry => {
      const name = encoder.encode(entry.name.replace(/\\/g, "/"));
      const data = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
      const crc = crc32(data);
      const local = writeHeader(30, [
        ["setUint32", [0, 0x04034b50, true]], ["setUint16", [4, 20, true]],
        ["setUint16", [6, 0x0800, true]], ["setUint16", [8, 0, true]],
        ["setUint16", [10, dosTime, true]], ["setUint16", [12, dosDate, true]],
        ["setUint32", [14, crc, true]], ["setUint32", [18, data.length, true]],
        ["setUint32", [22, data.length, true]], ["setUint16", [26, name.length, true]],
        ["setUint16", [28, 0, true]]
      ]);
      localChunks.push(local, name, data);

      const central = writeHeader(46, [
        ["setUint32", [0, 0x02014b50, true]], ["setUint16", [4, 20, true]],
        ["setUint16", [6, 20, true]], ["setUint16", [8, 0x0800, true]],
        ["setUint16", [10, 0, true]], ["setUint16", [12, dosTime, true]],
        ["setUint16", [14, dosDate, true]], ["setUint32", [16, crc, true]],
        ["setUint32", [20, data.length, true]], ["setUint32", [24, data.length, true]],
        ["setUint16", [28, name.length, true]], ["setUint16", [30, 0, true]],
        ["setUint16", [32, 0, true]], ["setUint16", [34, 0, true]],
        ["setUint16", [36, 0, true]], ["setUint32", [38, 0, true]],
        ["setUint32", [42, offset, true]]
      ]);
      centralChunks.push(central, name);
      offset += local.length + name.length + data.length;
    });

    const localData = joinBytes(localChunks);
    const centralData = joinBytes(centralChunks);
    const end = writeHeader(22, [
      ["setUint32", [0, 0x06054b50, true]], ["setUint16", [4, 0, true]],
      ["setUint16", [6, 0, true]], ["setUint16", [8, entries.length, true]],
      ["setUint16", [10, entries.length, true]], ["setUint32", [12, centralData.length, true]],
      ["setUint32", [16, localData.length, true]], ["setUint16", [20, 0, true]]
    ]);
    return new Blob([localData, centralData, end], { type: "application/zip" });
  }

  window.ConfigCore = Object.freeze({
    DEFAULT_N_BT,
    encodeSnToken,
    generateConfig,
    generateDeviceId,
    generateRandomMac,
    randomUserId,
    decodeHex,
    sanitizeFolder,
    createZip
  });
})();