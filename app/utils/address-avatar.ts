const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const avatarCache = new Map<string, string>();

export function isValidAddress(address?: string): address is string {
  if (!address || typeof address !== "string") return false;
  return ADDRESS_REGEX.test(address);
}

export function generateAddressAvatar(
  address: string,
  size: number | string = 48,
) {
  if (typeof document === "undefined") return null;
  if (!isValidAddress(address)) return null;

  const dimension = Number(size);
  if (!Number.isFinite(dimension) || dimension <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = dimension;
  canvas.height = dimension;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const hash = address.toLowerCase().slice(2);
  const color1 = `#${hash.slice(0, 6)}`;
  const color2 = `#${hash.slice(6, 12)}`;

  const gradient = ctx.createLinearGradient(0, 0, dimension, dimension);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, dimension, dimension);

  const gridSize = 5;
  const cellSize = dimension / gridSize;

  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < Math.ceil(gridSize / 2); col++) {
      const index = row * Math.ceil(gridSize / 2) + col;
      const hashValue = parseInt(hash.charAt(index % hash.length), 16);
      if (hashValue % 2 !== 0) continue;

      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      if (col !== Math.floor(gridSize / 2)) {
        ctx.fillRect(
          (gridSize - 1 - col) * cellSize,
          row * cellSize,
          cellSize,
          cellSize,
        );
      }
    }
  }

  return canvas;
}

export function getAddressAvatarDataUrl(
  address: string,
  size: number | string = 48,
  format = "image/png",
) {
  if (!isValidAddress(address)) return "";
  const dimension = Number(size);
  const key = `${address.toLowerCase()}-${dimension}-${format}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;

  const canvas = generateAddressAvatar(address, dimension);
  if (!canvas) return "";
  const url = canvas.toDataURL(format);
  avatarCache.set(key, url);
  return url;
}
