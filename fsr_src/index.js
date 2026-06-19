#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE_URL = 'https://repo.fortisoar.fortinet.com/fsr-widgets/';
const OUT_DIR = path.join(__dirname, 'widgets');
const EXTRACT_DIR = path.join(__dirname, 'widgets-extracted');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString()));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GET ${url} -> ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        file.close();
        fs.unlink(dest, () => {});
        return resolve(download(new URL(res.headers.location, url).toString(), dest));
      }
      if (res.statusCode !== 200) {
        res.resume();
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`GET ${url} -> ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function parseIndex(html) {
  const re = /href="([^"?][^"]*)\/"/g;
  const names = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = decodeURIComponent(m[1]);
    if (name === '..' || name === '.' || name.startsWith('/')) continue;
    names.add(name);
  }
  return [...names];
}

function splitNameVersion(entry) {
  const m = entry.match(/^(.+)-(\d+(?:\.\d+)*(?:[-.][A-Za-z0-9.]+)?)$/);
  if (!m) return null;
  return { widget: m[1], version: m[2] };
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const xa = pa[i] ?? '0';
    const xb = pb[i] ?? '0';
    const na = /^\d+$/.test(xa) ? Number(xa) : NaN;
    const nb = /^\d+$/.test(xb) ? Number(xb) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const c = xa.localeCompare(xb);
      if (c !== 0) return c;
    }
  }
  return 0;
}

function pickLatest(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const parsed = splitNameVersion(entry);
    if (!parsed) continue;
    const existing = groups.get(parsed.widget);
    if (!existing || compareVersions(parsed.version, existing.version) > 0) {
      groups.set(parsed.widget, parsed);
    }
  }
  return [...groups.values()].sort((a, b) => a.widget.localeCompare(b.widget));
}

function extract(archive, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const child = spawn('tar', ['-xzf', archive, '-C', destDir], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  console.log(`Fetching ${BASE_URL}`);
  const html = (await get(BASE_URL)).toString('utf8');
  const entries = parseIndex(html);
  const latest = pickLatest(entries);
  console.log(`Found ${entries.length} directories; ${latest.length} unique widgets.`);

  let ok = 0;
  let fail = 0;
  for (const { widget, version } of latest) {
    const folder = `${widget}-${version}`;
    const file = `${folder}.tgz`;
    const url = `${BASE_URL}${folder}/${file}`;
    const dest = path.join(OUT_DIR, file);
    const extractTo = path.join(EXTRACT_DIR, folder);

    try {
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        console.log(`= ${file} (already downloaded)`);
      } else {
        process.stdout.write(`downloading ${file} ... `);
        await download(url, dest);
        console.log('done');
      }

      if (fs.existsSync(extractTo) && fs.readdirSync(extractTo).length > 0) {
        console.log(`  = already extracted`);
      } else {
        process.stdout.write(`  extracting ... `);
        await extract(dest, extractTo);
        console.log('done');
      }
      ok++;
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      fail++;
    }
  }
  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
  console.log(`Archives: ${OUT_DIR}`);
  console.log(`Extracted: ${EXTRACT_DIR}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
