import './style.css';

const $ = (selector) => document.querySelector(selector);
const input = $('#fileInput');
const dropzone = $('#dropzone');
const runButton = $('#runButton');
const results = $('#results');
const status = $('#status');
let files = [];

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
  return `${Number((bytes / 1000 ** index).toFixed(2))} ${units[index]}`;
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint32be(view, offset) {
  if (offset + 4 > view.byteLength) return null;
  return view.getUint32(offset, false);
}

function detectFormat(bytes, file) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (bytes.length >= 8 && ascii(bytes, 1, 3) === 'PNG' && bytes[0] === 0x89) return 'PNG';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'WebP';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'GIF';
  if (bytes.length >= 2 && ascii(bytes, 0, 2) === 'BM') return 'BMP';
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (brand.includes('avif') || brand.includes('avis')) return 'AVIF';
    if (brand.includes('heic') || brand.includes('heif') || brand.includes('mif1')) return 'HEIF/HEIC';
  }
  if (file.type === 'image/svg+xml' || ascii(bytes, 0, Math.min(bytes.length, 256)).includes('<svg')) return 'SVG';
  return file.type.startsWith('image/') ? file.type.slice(6).toUpperCase() : 'Unknown';
}

function readDimensions(bytes, format) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === 'PNG' && bytes.length >= 24) return { width: uint32be(view, 16), height: uint32be(view, 20) };
  if (format === 'GIF' && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (format === 'BMP' && bytes.length >= 26) {
    const dibSize = uint32be(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 14);
    if (dibSize >= 40 && bytes.length >= 26) return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
  }
  if (format === 'WebP' && bytes.length >= 30 && ascii(bytes, 12, 4) === 'VP8X') {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
  }
  if (format === 'JPEG') return readJpegDimensions(bytes);
  return null;
}

function readJpegDimensions(bytes) {
  let offset = 2;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (frameMarkers.has(marker) && length >= 7) {
      return { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
    }
    offset += length;
  }
  return null;
}

function scanMetadata(bytes, format) {
  const tags = { EXIF: false, XMP: false, IPTC: false, Text: false };
  let complete = false;
  if (format === 'JPEG') {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda) { complete = true; break; }
      if (marker === 0xd9) { complete = true; break; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      const payload = offset + 2;
      const header = ascii(bytes, payload, Math.min(length - 2, 64));
      if (marker === 0xe1) {
        if (header.startsWith('Exif\0\0')) tags.EXIF = true;
        else if (header.startsWith('http://ns.adobe.com/xap/1.0/')) tags.XMP = true;
      }
      if (marker === 0xed) tags.IPTC = true;
      if (marker === 0xfe) tags.Text = true;
      offset += length;
    }
  } else if (format === 'PNG' && bytes.length >= 8) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = uint32be(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset);
      if (length == null || offset + length + 12 > bytes.length) break;
      const type = ascii(bytes, offset + 4, 4);
      if (type === 'eXIf') tags.EXIF = true;
      if (type === 'iTXt') {
        const keyword = ascii(bytes, offset + 8, Math.min(length, 80));
        if (keyword.startsWith('XML:com.adobe.xmp')) tags.XMP = true;
        else tags.Text = true;
      }
      if (['tEXt', 'zTXt'].includes(type)) tags.Text = true;
      offset += length + 12;
      if (type === 'IEND') { complete = true; break; }
    }
  } else if (format === 'WebP' && bytes.length >= 12) {
    let offset = 12;
    const declaredEnd = 8 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4);
      const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset + 4, true);
      if (offset + 8 + length > bytes.length) break;
      if (type === 'EXIF') tags.EXIF = true;
      if (type === 'XMP ') tags.XMP = true;
      offset += 8 + length + (length % 2);
      if (offset >= declaredEnd) { complete = declaredEnd <= bytes.length; break; }
    }
  }
  return { tags, complete };
}

async function inspect(file) {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
  const format = detectFormat(bytes, file);
  const dimensions = readDimensions(bytes, format);
  const metadata = scanMetadata(bytes, format);
  return { format, dimensions, metadata };
}

function addResult(file, report) {
  const card = document.createElement('article');
  card.className = 'result-card';
  const heading = document.createElement('strong');
  heading.textContent = file.name;
  const detail = document.createElement('div');
  detail.className = 'result-detail';
  const dimensions = report.dimensions ? `${report.dimensions.width} × ${report.dimensions.height} px` : 'Dimensions unavailable';
  const markers = Object.entries(report.metadata.tags).filter(([, present]) => present).map(([name]) => name);
  const metadataStatus = report.metadata.complete
    ? (markers.length ? `Markers found: ${markers.join(', ')}` : 'No scanned markers found')
    : (markers.length ? `Markers found: ${markers.join(', ')} · scan incomplete` : 'Metadata status unknown for this format or file');
  detail.innerHTML = `<span>${report.format}</span><span>${dimensions}</span><span>${formatSize(file.size)}</span><span>${metadataStatus}</span>`;
  card.append(heading, detail);
  results.append(card);
}

function setFiles(nextFiles) {
  files = [...nextFiles].filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|ico|heic|heif|svg)$/i.test(file.name));
  $('#fileSummary').textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected · ${formatSize(files.reduce((sum, file) => sum + file.size, 0))}` : 'No files selected';
  $('#clearButton').classList.toggle('hidden', !files.length);
  runButton.disabled = !files.length;
  runButton.textContent = files.length ? 'Inspect files' : 'Choose files to inspect';
  results.replaceChildren();
  status.textContent = files.length ? 'Only file headers are read; image pixels are not decoded.' : '';
}

dropzone.addEventListener('click', () => input.click());
dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
input.addEventListener('change', () => setFiles(input.files));
for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); });
dropzone.addEventListener('drop', (event) => setFiles(event.dataTransfer.files));
$('#clearButton').addEventListener('click', () => { input.value = ''; setFiles([]); });
runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  results.replaceChildren();
  let complete = 0;
  for (const file of files) {
    status.textContent = `Inspecting ${complete + 1}/${files.length}…`;
    try { addResult(file, await inspect(file)); }
    catch { addResult(file, { format: 'Unknown', dimensions: null, metadata: { tags: {}, complete: false } }); }
    complete++;
  }
  status.textContent = `Inspection complete: ${complete} file${complete === 1 ? '' : 's'}.`;
  runButton.disabled = false;
});
