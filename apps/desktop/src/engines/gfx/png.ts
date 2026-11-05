const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Dimensi PNG harus berupa bilangan bulat positif.');
  }
}

export function assertPngDimensions(bytes: Uint8Array, width: number, height: number): void {
  assertDimensions(width, height);
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error('Penanda PNG tidak sah atau header terpotong.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    throw new Error('Header IHDR PNG tidak sah.');
  }
  const actualWidth = view.getUint32(16);
  const actualHeight = view.getUint32(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`Dimensi PNG ${actualWidth}x${actualHeight} tidak sesuai dengan ${width}x${height}.`);
  }
}

function assertSvg(svg: string): void {
  if (!svg.trim().startsWith('<svg ') || !svg.includes('</svg>')) {
    throw new Error('Masukan SVG tidak sah.');
  }
}

export async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  assertDimensions(width, height);
  assertSvg(svg);
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Ekspor PNG memerlukan lingkungan peramban.');
  }

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Gambar SVG tidak dapat dimuat.'));
    });
    image.src = objectUrl;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Konteks kanvas 2D tidak tersedia.');
    }
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result || result.size === 0) {
          reject(new Error('Ekspor PNG tidak menghasilkan data.'));
          return;
        }
        resolve(result);
      }, 'image/png');
    });
    const bytes = new Uint8Array(await pngBlob.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error('Ekspor PNG tidak menghasilkan data.');
    }
    assertPngDimensions(bytes, width, height);
    return bytes;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
