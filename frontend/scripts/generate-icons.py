"""Rasterize the simple favicon geometry with stdlib Python; no font dependencies.

Run from any directory with: python3 frontend/scripts/generate-icons.py
"""

import math
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
import zlib

PUBLIC = Path(__file__).resolve().parents[1] / "public"
SVG = "{http://www.w3.org/2000/svg}"


def rectangle_distance(x, y, rect):
    width, height = float(rect.attrib["width"]), float(rect.attrib["height"])
    radius = float(rect.attrib.get("rx", 0))
    dx = abs(x - float(rect.attrib.get("x", 0)) - width / 2) - width / 2 + radius
    dy = abs(y - float(rect.attrib.get("y", 0)) - height / 2) - height / 2 + radius
    return math.hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - radius


def line_distance(x, y, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    t = max(0, min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - start[0] - t * dx, y - start[1] - t * dy)


def chunk(kind, data):
    return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))


def generate(size):
    root = ET.parse(PUBLIC / "favicon.svg").getroot()
    background = root.find(f"{SVG}rect")
    strokes = root.find(f"{SVG}g")
    envelope = strokes.find(f"{SVG}rect")
    points = [tuple(map(float, p.split(","))) for p in strokes.find(f"{SVG}polyline").attrib["points"].split()]
    color = bytes.fromhex(background.attrib["fill"].removeprefix("#"))
    half_stroke = float(strokes.attrib["stroke-width"]) / 2
    samples = 4  # Supersampling smooths corners and diagonal strokes.
    rows = bytearray()
    for row in range(size):
        rows.append(0)  # PNG scanline filter: none.
        for col in range(size):
            alpha = white = 0
            for sy in range(samples):
                for sx in range(samples):
                    x = (col + (sx + 0.5) / samples) * 64 / size
                    y = (row + (sy + 0.5) / samples) * 64 / size
                    if rectangle_distance(x, y, background) > 0:
                        continue
                    alpha += 1
                    if abs(rectangle_distance(x, y, envelope)) <= half_stroke or any(
                        line_distance(x, y, a, b) <= half_stroke
                        for a, b in zip(points, points[1:])
                    ):
                        white += 1
            rows.extend(round(c + (255 - c) * white / alpha) if alpha else 0 for c in color)
            rows.append(round(255 * alpha / (samples * samples)))
    header = struct.pack("!2I5B", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
    destination = PUBLIC / "icons" / f"icon-{size}.png"
    destination.parent.mkdir(exist_ok=True)
    destination.write_bytes(png)


if __name__ == "__main__":
    for dimension in (192, 512):
        generate(dimension)
