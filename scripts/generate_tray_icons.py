#!/usr/bin/env python3
"""Generate the theme-aware Windows tray icons from SayIt's source glyph."""

from __future__ import annotations

import argparse
import struct
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CHANNELS = 4
CONTRAST_THRESHOLD = 40
CONTRAST_MULTIPLIER = 1.55


def paeth(left: int, above: int, upper_left: int) -> int:
    prediction = left + above - upper_left
    left_distance = abs(prediction - left)
    above_distance = abs(prediction - above)
    upper_left_distance = abs(prediction - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    if above_distance <= upper_left_distance:
        return above
    return upper_left


def read_rgba_png(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"{path} is not a PNG file")

    position = len(PNG_SIGNATURE)
    header: tuple[int, int, int, int, int, int, int] | None = None
    compressed = bytearray()

    while position < len(data):
        length = struct.unpack_from(">I", data, position)[0]
        chunk_type = data[position + 4 : position + 8]
        chunk_data = data[position + 8 : position + 8 + length]
        position += 12 + length

        if chunk_type == b"IHDR":
            header = struct.unpack(">IIBBBBB", chunk_data)
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            break

    if header is None:
        raise ValueError(f"{path} is missing an IHDR chunk")

    width, height, bit_depth, color_type, compression, filter_method, interlace = header
    if (bit_depth, color_type, compression, filter_method, interlace) != (8, 6, 0, 0, 0):
        raise ValueError(
            f"{path} must be a non-interlaced 8-bit RGBA PNG; got "
            f"bit_depth={bit_depth}, color_type={color_type}, compression={compression}, "
            f"filter={filter_method}, interlace={interlace}"
        )

    stride = width * CHANNELS
    raw = zlib.decompress(compressed)
    expected_length = height * (stride + 1)
    if len(raw) != expected_length:
        raise ValueError(f"{path} has an invalid decompressed data length")

    pixels = bytearray(width * height * CHANNELS)
    previous = bytearray(stride)
    offset = 0
    for row in range(height):
        filter_type = raw[offset]
        offset += 1
        current = bytearray(raw[offset : offset + stride])
        offset += stride

        for index in range(stride):
            left = current[index - CHANNELS] if index >= CHANNELS else 0
            above = previous[index]
            upper_left = previous[index - CHANNELS] if index >= CHANNELS else 0

            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                predictor = paeth(left, above, upper_left)
            else:
                raise ValueError(f"{path} uses unsupported PNG filter {filter_type}")

            current[index] = (current[index] + predictor) & 0xFF

        row_start = row * stride
        pixels[row_start : row_start + stride] = current
        previous = current

    return width, height, pixels


def chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def write_rgba_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    stride = width * CHANNELS
    rows = bytearray()
    for row in range(height):
        rows.append(0)
        row_start = row * stride
        rows.extend(pixels[row_start : row_start + stride])

    encoded = (
        PNG_SIGNATURE
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows, level=9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(encoded)


def build_s2_alpha(width: int, height: int, source: bytearray) -> bytearray:
    source_alpha = [source[index + 3] for index in range(0, len(source), CHANNELS)]
    processed = bytearray(width * height)

    for y in range(height):
        for x in range(width):
            alpha = max(
                source_alpha[neighbor_y * width + neighbor_x]
                for neighbor_y in range(max(0, y - 1), min(height, y + 2))
                for neighbor_x in range(max(0, x - 1), min(width, x + 2))
            )
            if alpha > CONTRAST_THRESHOLD:
                alpha = min(255, int(alpha * CONTRAST_MULTIPLIER))
            processed[y * width + x] = alpha

    return processed


def colorize(alpha: bytearray, red: int, green: int, blue: int) -> bytearray:
    pixels = bytearray(len(alpha) * CHANNELS)
    for index, opacity in enumerate(alpha):
        pixel_index = index * CHANNELS
        pixels[pixel_index : pixel_index + CHANNELS] = bytes((red, green, blue, opacity))
    return pixels


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=root / "src-tauri" / "icons" / "tray-icon.png",
        help="source RGBA glyph PNG",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=root / "src-tauri" / "icons",
        help="destination directory for generated icons",
    )
    args = parser.parse_args()

    width, height, source = read_rgba_png(args.source)
    alpha = build_s2_alpha(width, height, source)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    write_rgba_png(
        args.output_dir / "tray-icon-dark.png",
        width,
        height,
        colorize(alpha, 255, 255, 255),
    )
    write_rgba_png(
        args.output_dir / "tray-icon-light.png",
        width,
        height,
        colorize(alpha, 0, 0, 0),
    )


if __name__ == "__main__":
    main()
