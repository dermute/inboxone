import { useEffect, useRef } from "react";

import { useAccounts } from "../api/useAccounts";

const BASE_ICON_SRC = "/favicon.svg";
const CANVAS_SIZE = 64; // 2x the 32x32 viewBox, for crispness at real favicon sizes

let cachedBaseIcon: HTMLImageElement | null = null;
function loadBaseIcon(): Promise<HTMLImageElement> {
  if (cachedBaseIcon) return Promise.resolve(cachedBaseIcon);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cachedBaseIcon = img;
      resolve(img);
    };
    img.onerror = reject;
    img.src = BASE_ICON_SRC;
  });
}

function getOrCreateIconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

function drawBadgedIcon(canvas: HTMLCanvasElement, base: HTMLImageElement, count: number): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return BASE_ICON_SRC;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const label = count > 99 ? "99+" : String(count);
  const radius = label.length > 2 ? 20 : label.length > 1 ? 18 : 15;
  const cx = CANVAS_SIZE - radius - 2;
  const cy = radius + 2;

  // White ring so the badge stays legible against dark browser-chrome tabs too.
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#dc2626"; // red-600, matches the app's error/danger color
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = `bold ${label.length > 2 ? 17 : 20}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);

  return canvas.toDataURL("image/png");
}

// Renders nothing - keeps the document title and favicon in sync with the
// total unread count. The title is invisible once a tab is pinned (only the
// favicon shows), so the count is also drawn as a badge onto a canvas copy
// of the favicon and swapped in as the tab icon.
export default function TabUnreadIndicator() {
  const { data: accounts } = useAccounts();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDrawnCount = useRef<number | null>(null);

  useEffect(() => {
    const total = (accounts ?? []).reduce(
      (sum, account) => sum + account.folders.reduce((s, f) => s + f.unread_count, 0),
      0
    );
    document.title = total > 0 ? `(${total}) inboxone` : "inboxone";

    if (total === lastDrawnCount.current) return;
    lastDrawnCount.current = total;

    const link = getOrCreateIconLink();
    if (total <= 0) {
      link.href = BASE_ICON_SRC;
      link.type = "image/svg+xml";
      return;
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = CANVAS_SIZE;
      canvasRef.current.height = CANVAS_SIZE;
    }
    loadBaseIcon()
      .then((base) => {
        link.href = drawBadgedIcon(canvasRef.current!, base, total);
        link.type = "image/png";
      })
      .catch(() => {
        // Base icon failed to load (e.g. offline reload) - leave the
        // existing favicon/title as-is rather than breaking the tab icon.
      });
  }, [accounts]);

  useEffect(() => {
    return () => {
      document.title = "inboxone";
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) {
        link.href = BASE_ICON_SRC;
        link.type = "image/svg+xml";
      }
    };
  }, []);

  return null;
}
